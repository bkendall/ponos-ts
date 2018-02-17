import {expect} from 'chai';
import {PonosWorker} from '../src/worker';

describe('create', () => {
  const fakeData = { message: '' };

  it('should return a PonosWorker', () => {
    const newWorker = PonosWorker.create(
      0,
      fakeData,
      'someQueue',
      (data) => {});

    expect(newWorker).to.be.an.instanceof(PonosWorker);
  });
});
