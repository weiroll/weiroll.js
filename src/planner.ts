'use strict';

import { hexConcat, hexlify } from '@ethersproject/bytes';
import { Heap } from 'heap-js';
import {
  FunctionCall,
  isDynamicType,
  isLiteralValue,
  Value,
} from './base-contract';

export interface ReturnValue extends Value {
  readonly planner: Planner;
  readonly commandIndex: number; // Index of the command in the array of planned commands
}

export function isReturnValue(value: any): value is ReturnValue {
  return (value as ReturnValue).commandIndex !== undefined;
}

export class Planner {
  calls: FunctionCall[];

  constructor() {
    this.calls = [];
  }

  addCommand(call: FunctionCall): ReturnValue | null {
    for (let arg of call.args) {
      if (isReturnValue(arg)) {
        if (arg.planner != this) {
          throw new Error('Cannot reuse return values across planners');
        }
      }
    }

    const commandIndex = this.calls.length;
    this.calls.push(call);

    if (call.fragment.outputs.length != 1) {
      return null;
    }
    return { planner: this, commandIndex, param: call.fragment.outputs[0] };
  }

  plan(): { commands: string[]; state: string[] } {
    // Tracks the last time a literal is used in the program
    let literalVisibility = new Map<string, number>();
    // Tracks the last time a command's output is used in the program
    let commandVisibility: number[] = Array(this.calls.length).fill(-1);

    // Build visibility maps
    for (let i = 0; i < this.calls.length; i++) {
      const call = this.calls[i];
      for (let arg of call.args) {
        if (isReturnValue(arg)) {
          commandVisibility[arg.commandIndex] = i;
        } else if (isLiteralValue(arg)) {
          literalVisibility.set(arg.value, i);
        } else {
          throw new Error('Unknown function argument type');
        }
      }
    }

    // Tracks when state slots go out of scope
    type HeapEntry = { slot: number; dies: number };
    let nextDeadSlot = new Heap<HeapEntry>((a, b) => a.dies - b.dies);

    // Tracks the state slot each literal is stored in
    let literalSlotMap = new Map<string, number>();
    // Tracks the state slot each return value is stored in
    let returnSlotMap = Array(this.calls.length);

    let commands: string[] = [];
    let state: string[] = [];

    // Prepopulate the state with literals
    literalVisibility.forEach((dies, literal) => {
      const slot = state.length;
      literalSlotMap.set(literal, slot);
      nextDeadSlot.push({ slot, dies });
      state.push(literal);
    });

    // Build commands, and add state entries as needed
    for (let i = 0; i < this.calls.length; i++) {
      const call = this.calls[i];

      // Build a list of argument value indexes
      const args = new Uint8Array(7).fill(0xff);
      call.args.forEach((arg, j) => {
        let slot;
        if (isReturnValue(arg)) {
          slot = returnSlotMap[arg.commandIndex];
        } else if (isLiteralValue(arg)) {
          slot = literalSlotMap.get(arg.value);
        } else {
          throw new Error('Unknown function argument type');
        }
        if (isDynamicType(arg.param)) {
          slot |= 0x80;
        }
        args[j] = slot;
      });

      // Figure out where to put the return value
      let ret = 0xff;
      if (commandVisibility[i] != -1) {
        ret = state.length;

        // Is there a spare state slot?
        if (nextDeadSlot.peek().dies <= i) {
          ret = nextDeadSlot.pop().slot;
        }

        // Store the slot mapping
        returnSlotMap[i] = ret;

        // Make the slot available when it's not needed
        nextDeadSlot.push({ slot: ret, dies: commandVisibility[i] });

        if (ret == state.length) {
          state.push('0x');
        }

        if (isDynamicType(call.fragment.outputs[0])) {
          ret |= 0x80;
        }
      }

      commands.push(
        hexConcat([
          call.contract.interface.getSighash(call.fragment),
          hexlify(args),
          hexlify([ret]),
          call.contract.address,
        ])
      );
    }

    return { commands, state };
  }
}
