'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createProductStore} = require('../product-store');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function scope() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {value:'', disabled:false, textContent:'',
      dataset:{}, replaceChildren(){}, checkValidity(){return true;}});
    return elements.get(id);
  }
  element('customQuoteCapacity').value = '100';
  element('customQuoteDuration').value = '120';
  element('customQuoteSessions').value = '1';
  element('customQuoteLanguages').value = '1';
  element('customQuoteLanguages').closest = () => ({});
  const status = [];
  const redirects = [];
  const context = {state: {account: {id:'test'}, billing:{directVideoUploadsConfigured:false}},
    byId:element, all:()=>[], IS_QSESSION_ANDROID:false,
    document:{createElement:()=>({textContent:''})},
    billingMoney:value=>String(value), setStatus:(_target,message)=>status.push(message),
    window:{setTimeout,clearTimeout}, location:{assign:url=>redirects.push(url)},
    api:async()=>{throw Error('Unexpected request');}, status, redirects,
    copyRoomShareValue:async()=>{}};
  vm.createContext(context);
  const begin = source.indexOf('function syncCustomQuoteControls()');
  const end = source.indexOf('function sessionDurationLabel(', begin);
  assert.ok(begin > 0 && end > begin);
  vm.runInContext(source.slice(begin,end),context);
  return context;
}

function result(capacity=100) {
  return {quoteToken:`token-${capacity}`, checkoutConfigured:true, expiresAt:new Date(Date.now()+60000).toISOString(),
    quote:{capacity,requiresReview:capacity>5000,priceCents:100,sessions:1,lineItems:[]}};
}

test('editing a quotation immediately removes its old purchase authority', () => {
  const c = scope();
  c.renderCustomQuote(result());
  assert.equal(c.byId('customQuotePurchase').disabled,false);
  c.scheduleCustomQuote();
  assert.equal(c.state.customQuote,null);
  assert.equal(c.byId('customQuotePurchase').disabled,true);
  assert.equal(c.byId('customQuoteCopy').disabled,true);
  clearTimeout(c.state.customQuoteTimer);
});

test('late quotation responses cannot overwrite a newer requested aforo', async () => {
  const c = scope();
  const replies = [];
  c.api = () => new Promise(resolve=>replies.push(resolve));
  const first = c.calculateCustomQuote();
  c.byId('customQuoteCapacity').value = '12345';
  const second = c.calculateCustomQuote();
  replies[1](result(12345));
  await second;
  replies[0](result(100));
  await first;
  assert.equal(c.state.customQuote.quote.capacity,12345);
  assert.equal(c.byId('customQuotePurchase').disabled,true);
  assert.match(c.byId('customQuotePriceLabel').textContent,/ESTIMACIÓN/);
});

test('an invalid manual aforo cannot retain a previous payable quote', async () => {
  const c = scope();
  c.renderCustomQuote(result());
  c.byId('customQuoteForm').checkValidity = () => false;
  await c.calculateCustomQuote();
  assert.equal(c.state.customQuote,null);
  assert.equal(c.byId('customQuotePurchase').disabled,true);
});

test('a pending order cannot redirect or re-enable payment after the quote is changed or closed', async () => {
  for (const succeeds of [true,false]) {
    const c = scope();
    c.renderCustomQuote(result());
    let resolve, reject;
    c.api = () => new Promise((ok,no)=>{resolve=ok;reject=no;});
    const pending = c.purchaseCustomQuote();
    c.invalidateCustomQuote();
    if (succeeds) resolve({checkout:{url:'https://checkout.example/old'}});
    else reject(Error('Failed request'));
    await pending;
    assert.deepEqual(c.redirects,[]);
    assert.equal(c.byId('customQuotePurchase').disabled,true);
  }
});

test('a reviewed broadcast estimate cannot reach the payment API', async () => {
  const c=scope();
  c.renderCustomQuote(result(10000));
  await c.purchaseCustomQuote();
  assert.equal(c.byId('customQuotePurchase').disabled,true);
});

test('manual room limits reject invalid changes atomically and preserve the paid plan', () => {
  const store = createProductStore();
  const room=store.createRoomRecord({code:'LIM123',name:'Aforo manual',capacity:1000,
    billingPlanId:'large-event-1000',billingCapacityLimit:1000,capacityMode:'expected',visibility:'private'});
  for (const capacity of [1001,10000,-1,1.5,NaN,true,[],null,0,'']) {
    assert.throws(()=>store.updateRoomConfiguration(room.code,{capacity,capacityMode:'limited',visibility:'public'}));
    const unchanged=store.getRoomRecord(room.code);
    assert.equal(unchanged.capacity,1000);
    assert.equal(unchanged.visibility,'private');
  }
  const updated=store.updateRoomConfiguration(room.code,{capacity:731,capacityMode:'limited'});
  assert.equal(updated.capacity,731);
  assert.equal(updated.capacityMode,'limited');
  assert.equal(updated.billingCapacityLimit,1000);
});
