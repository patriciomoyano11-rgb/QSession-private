import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregate} from './model.mjs';
const labels=[['calm','calm music'],['intense','intense music']];
const row=(a,b)=>[{label:'calm music',score:a},{label:'intense music',score:b}];
test('semantic ambiguity and disagreement cause abstention',()=>{
  assert.equal(aggregate([row(.51,.49),row(.52,.48),row(.5,.5)],labels).accepted,false);
  assert.equal(aggregate([row(.99,.01),row(.01,.99),row(.01,.99)],labels).value,'intense');
  assert.equal(aggregate([row(.9,.1),row(.87,.13),row(.92,.08)],labels).accepted,true);
});
