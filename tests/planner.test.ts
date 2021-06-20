import { ethers } from 'ethers';
import { hexDataSlice } from '@ethersproject/bytes';
import { defaultAbiCoder } from '@ethersproject/abi';
import { Contract, Planner } from '../src/planner';
import * as mathABI from '../abis/Math.json';
import * as stringsABI from '../abis/Strings.json';

const SAMPLE_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

describe('Contract', () => {
  let Math: Contract;

  beforeAll(() => {
    Math = Contract.fromEthersContract(
      new ethers.Contract(SAMPLE_ADDRESS, mathABI.abi)
    );
  });

  it('wraps contract objects and exposes their functions', () => {
    // there is no function in jest as 'to.not.be.undefined'
    expect(Math.add).toBeTruthy;
  });

  it('returns a FunctionCall when contract functions are called', () => {
    const result = Math.add(1, 2);

    expect(result.contract).toEqual(Math);
    expect(result.fragment).toEqual(Math.interface.getFunction('add'));

    const args = result.args;
    expect(args.length).toEqual(2);
    expect(args[0].param).toEqual(Math.interface.getFunction('add').inputs[0]);
    expect(args[0].value).toEqual(defaultAbiCoder.encode(['uint'], [1]));
    expect(args[1].param).toEqual(Math.interface.getFunction('add').inputs[1]);
    expect(args[1].value).toEqual(defaultAbiCoder.encode(['uint'], [2]));
  });
});

describe('Planner', () => {
  let Math: Contract;
  let Strings: Contract;

  beforeAll(() => {
    Math = Contract.fromEthersContract(
      new ethers.Contract(SAMPLE_ADDRESS, mathABI.abi)
    );
    Strings = Contract.fromEthersContract(
      new ethers.Contract(SAMPLE_ADDRESS, stringsABI.abi)
    );
  });

  it('adds function calls to a list of commands', () => {
    const planner = new Planner();
    const sum1 = planner.add(Math.add(1, 2));
    const sum2 = planner.add(Math.add(3, 4));
    const sum3 = planner.add(Math.add(sum1, sum2));

    expect(planner.calls.length).toEqual(3);
    expect(sum1!.commandIndex).toEqual(0);
    expect(sum2!.commandIndex).toEqual(1);
    expect(sum3!.commandIndex).toEqual(2);
  });

  it('plans a simple program', () => {
    const planner = new Planner();
    planner.add(Math.add(1, 2));
    const { commands, state } = planner.plan();

    expect(commands.length).toEqual(1);
    expect(commands[0]).toEqual(
      '0x771602f70001ffffffffffffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );

    expect(state.length).toEqual(2);
    expect(state[0]).toEqual(defaultAbiCoder.encode(['uint'], [1]));
    expect(state[1]).toEqual(defaultAbiCoder.encode(['uint'], [2]));
  });

  it('deduplicates identical literals', () => {
    const planner = new Planner();
    const { state } = planner.plan();

    expect(state.length).toEqual(1);
  });

  it('plans a program that uses return values', () => {
    const planner = new Planner();
    const sum1 = planner.add(Math.add(1, 2));
    planner.add(Math.add(sum1, 3));
    const { commands, state } = planner.plan();

    expect(commands.length).toEqual(2);
    expect(commands[0]).toEqual(
      '0x771602f70001ffffffffff00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );
    expect(commands[1]).toEqual(
      '0x771602f70002ffffffffffffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );

    expect(state.length).toEqual(3);
    expect(state[0]).toEqual(defaultAbiCoder.encode(['uint'], [1]));
    expect(state[1]).toEqual(defaultAbiCoder.encode(['uint'], [2]));
    expect(state[2]).toEqual(defaultAbiCoder.encode(['uint'], [3]));
  });

  it('plans a program that needs extra state slots for intermediate values', () => {
    const planner = new Planner();
    const sum1 = planner.add(Math.add(1, 1));
    planner.add(Math.add(1, sum1));
    const { commands, state } = planner.plan();

    expect(commands.length).toEqual(2);
    expect(commands[0]).toEqual(
      '0x771602f70000ffffffffff01eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );
    expect(commands[1]).toEqual(
      '0x771602f70001ffffffffffffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );

    expect(state.length).toEqual(2);
    expect(state[0]).toEqual(defaultAbiCoder.encode(['uint'], [1]));
    expect(state[1]).toEqual('0x');
  });

  it('plans a program that takes dynamic arguments', () => {
    const planner = new Planner();
    planner.add(Strings.strlen('Hello, world!'));
    const { commands, state } = planner.plan();

    expect(commands.length).toEqual(1);
    expect(commands[0]).toEqual(
      '0x367bbd7880ffffffffffffffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );

    expect(state.length).toEqual(1);
    expect(state[0]).toEqual(
      hexDataSlice(defaultAbiCoder.encode(['string'], ['Hello, world!']), 32)
    );
  });

  it('plans a program that returns dynamic arguments', () => {
    const planner = new Planner();
    planner.add(Strings.strcat('Hello, ', 'world!'));
    const { commands, state } = planner.plan();

    expect(commands.length).toEqual(1);
    expect(commands[0]).toEqual(
      '0xd824ccf38081ffffffffffffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );

    expect(state.length).toEqual(2);
    expect(state[0]).toEqual(
      hexDataSlice(defaultAbiCoder.encode(['string'], ['Hello, ']), 32)
    );
    expect(state[1]).toEqual(
      hexDataSlice(defaultAbiCoder.encode(['string'], ['world!']), 32)
    );
  });

  it('plans a program that takes a dynamic argument from a return value', () => {
    const planner = new Planner();
    const str = planner.add(Strings.strcat('Hello, ', 'world!'));
    planner.add(Strings.strlen(str));
    const { commands, state } = planner.plan();

    expect(commands.length).toEqual(2);
    expect(commands[0]).toEqual(
      '0xd824ccf38081ffffffffff80eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );
    expect(commands[1]).toEqual(
      '0x367bbd7880ffffffffffffffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );

    expect(state.length).toEqual(2);
    expect(state[0]).toEqual(
      hexDataSlice(defaultAbiCoder.encode(['string'], ['Hello, ']), 32)
    );
    expect(state[1]).toEqual(
      hexDataSlice(defaultAbiCoder.encode(['string'], ['world!']), 32)
    );
  });

  it('requires argument counts to match the function definition', () => {
    const planner = new Planner();
    expect(() => planner.add(Math.add(1))).toThrow();
  });

  it('plans a call to a function that takes and replaces the current state', () => {
    const TestContract = Contract.fromEthersContract(
      new ethers.Contract(SAMPLE_ADDRESS, [
        'function useState(bytes[] state) returns(bytes[])',
      ])
    );

    const planner = new Planner();
    planner.replaceState(TestContract.useState(planner.state));
    const { commands, state } = planner.plan();

    expect(commands.length).toEqual(1);
    expect(commands[0]).toEqual(
      '0x08f389c8fefffffffffffffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );

    expect(state.length).toEqual(0);
  });
});
