import * as chai from 'chai';
import { expect } from 'chai';
import { ethers } from 'ethers';
import { hexDataSlice } from '@ethersproject/bytes';
import { defaultAbiCoder } from '@ethersproject/abi';
import { Contract, Planner, ReturnValue } from '../src/planner';
import * as mathABI from '../abis/Math.json';
import * as stringsABI from '../abis/Strings.json';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SAMPLE_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

describe('Contract', () => {
  let Math: Contract;

  before(() => {
    Math = Contract.fromEthersContract(
      new ethers.Contract(SAMPLE_ADDRESS, mathABI.abi)
    );
  });

  it('wraps contract objects and exposes their functions', () => {
    expect(Math.add).to.not.be.undefined;
  });

  it('returns a FunctionCall when contract functions are called', () => {
    const result = Math.add(1, 2);

    expect(result.contract).to.equal(Math);
    expect(result.fragment).to.equal(Math.interface.getFunction('add'));

    const args = result.args;
    expect(args.length).to.equal(2);
    expect(args[0].param).to.equal(Math.interface.getFunction('add').inputs[0]);
    expect(args[0].value).to.equal(defaultAbiCoder.encode(['uint'], [1]));
    expect(args[1].param).to.equal(Math.interface.getFunction('add').inputs[1]);
    expect(args[1].value).to.equal(defaultAbiCoder.encode(['uint'], [2]));
  });
});

describe('Planner', () => {
  let Math: Contract;
  let Strings: Contract;

  before(() => {
    Math = Contract.fromEthersContract(
      new ethers.Contract(SAMPLE_ADDRESS, mathABI.abi)
    );
    Strings = Contract.fromEthersContract(
      new ethers.Contract(SAMPLE_ADDRESS, stringsABI.abi)
    );
  });

  it('adds function calls to a list of commands', () => {
    const planner = new Planner();
    const sum1 = planner.addCommand(Math.add(1, 2));
    const sum2 = planner.addCommand(Math.add(3, 4));
    const sum3 = planner.addCommand(Math.add(sum1, sum2));

    expect(planner.calls.length).to.equal(3);
    expect(sum1.commandIndex).to.equal(0);
    expect(sum2.commandIndex).to.equal(1);
    expect(sum3.commandIndex).to.equal(2);
  });

  it('plans a simple program', () => {
    const planner = new Planner();
    planner.addCommand(Math.add(1, 2));
    const { commands, state } = planner.plan();

    expect(commands.length).to.equal(1);
    expect(commands[0]).to.equal(
      '0x771602f70001ffffffffffffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );

    expect(state.length).to.equal(2);
    expect(state[0]).to.equal(defaultAbiCoder.encode(['uint'], [1]));
    expect(state[1]).to.equal(defaultAbiCoder.encode(['uint'], [2]));
  });

  it('deduplicates identical literals', () => {
    const planner = new Planner();
    const sum1 = planner.addCommand(Math.add(1, 1));
    const { commands, state } = planner.plan();

    expect(state.length).to.equal(1);
  });

  it('plans a program that uses return values', () => {
    const planner = new Planner();
    const sum1 = planner.addCommand(Math.add(1, 2));
    planner.addCommand(Math.add(sum1, 3));
    const { commands, state } = planner.plan();

    expect(commands.length).to.equal(2);
    expect(commands[0]).to.equal(
      '0x771602f70001ffffffffff00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );
    expect(commands[1]).to.equal(
      '0x771602f70002ffffffffffffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );

    expect(state.length).to.equal(3);
    expect(state[0]).to.equal(defaultAbiCoder.encode(['uint'], [1]));
    expect(state[1]).to.equal(defaultAbiCoder.encode(['uint'], [2]));
    expect(state[2]).to.equal(defaultAbiCoder.encode(['uint'], [3]));
  });

  it('plans a program that needs extra state slots for intermediate values', () => {
    const planner = new Planner();
    const sum1 = planner.addCommand(Math.add(1, 1));
    planner.addCommand(Math.add(1, sum1));
    const { commands, state } = planner.plan();

    expect(commands.length).to.equal(2);
    expect(commands[0]).to.equal(
      '0x771602f70000ffffffffff01eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );
    expect(commands[1]).to.equal(
      '0x771602f70001ffffffffffffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );

    expect(state.length).to.equal(2);
    expect(state[0]).to.equal(defaultAbiCoder.encode(['uint'], [1]));
    expect(state[1]).to.equal('0x');
  });

  it('plans a program that takes dynamic arguments', () => {
    const planner = new Planner();
    planner.addCommand(Strings.strlen('Hello, world!'));
    const { commands, state } = planner.plan();

    expect(commands.length).to.equal(1);
    expect(commands[0]).to.equal(
      '0x367bbd7880ffffffffffffffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );

    expect(state.length).to.equal(1);
    expect(state[0]).to.equal(
      hexDataSlice(defaultAbiCoder.encode(['string'], ['Hello, world!']), 32)
    );
  });

  it('plans a program that returns dynamic arguments', () => {
    const planner = new Planner();
    planner.addCommand(Strings.strcat('Hello, ', 'world!'));
    const { commands, state } = planner.plan();

    expect(commands.length).to.equal(1);
    expect(commands[0]).to.equal(
      '0xd824ccf38081ffffffffffffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );

    expect(state.length).to.equal(2);
    expect(state[0]).to.equal(
      hexDataSlice(defaultAbiCoder.encode(['string'], ['Hello, ']), 32)
    );
    expect(state[1]).to.equal(
      hexDataSlice(defaultAbiCoder.encode(['string'], ['world!']), 32)
    );
  });

  it('plans a program that takes a dynamic argument from a return value', () => {
    const planner = new Planner();
    const str = planner.addCommand(Strings.strcat('Hello, ', 'world!'));
    planner.addCommand(Strings.strlen(str));
    const { commands, state } = planner.plan();

    expect(commands.length).to.equal(2);
    expect(commands[0]).to.equal(
      '0xd824ccf38081ffffffffff80eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );
    expect(commands[1]).to.equal(
      '0x367bbd7880ffffffffffffffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );

    expect(state.length).to.equal(2);
    expect(state[0]).to.equal(
      hexDataSlice(defaultAbiCoder.encode(['string'], ['Hello, ']), 32)
    );
    expect(state[1]).to.equal(
      hexDataSlice(defaultAbiCoder.encode(['string'], ['world!']), 32)
    );
  });
});
