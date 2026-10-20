'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const location = require('../public/country-location');
const {createProductStore} = require('../product-store');
const scope = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/data/world-countries.js'), 'utf8'), scope);
const map = scope.window.QSESSION_WORLD_COUNTRIES;
const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

test('real country geometry identifies Colombian cities regardless of US device region', () => {
  for (const [latitude, longitude] of [[4.71,-74.07],[6.25,-75.57],[3.45,-76.53],[10.39,-75.48]]) {
    assert.equal(location.countryCode(map, {latitude, longitude, locale: 'en-US'}), 'CO');
  }
  assert.equal(location.countryCode(map, {latitude:38.9, longitude:-77.04}), 'US');
  assert.equal(new Set(map.countries.map(c=>c.code)).size, map.countries.length);
});

test('ocean, invalid positions and bounding rectangles cannot invent a country', () => {
  for (const coords of [{latitude:null,longitude:null},{latitude:91,longitude:0},{latitude:NaN,longitude:0},{latitude:0,longitude:-140}]) assert.equal(location.countryCode(map,coords),'');
  const triangle = {countries:[{code:'CO',bounds:[0,0,1000,500],path:'M0,0L1000,0L0,500Z'}]};
  assert.equal(location.countryCode(triangle,{latitude:-80,longitude:170}),'');
  assert.equal(location.countryCode({countries:[]},{latitude:4.71,longitude:-74.07}),'');
});

test('old country records expire and future timestamps are rejected', () => {
  const now = Date.now();
  assert.equal(location.freshCountry({code:'CO',verifiedAt:now,verifiedBy:'gps'},now),'CO');
  for (const record of ['US',{code:'US'},{code:'US',verifiedAt:now-1800000},{code:'CO',verifiedAt:now+1}]) assert.equal(location.freshCountry(record,now),'');
});

function clientFixture() {
  const stored = new Map([['qsession-global-country-gps-v1-person','US']]);
  const calls = []; const context = {window:{QSessionCountryLocation:location},GLOBAL_RAVE_COUNTRY_MAP:map,
    state:{account:{id:'person'},profile:{visible:true,globalRaveCountryCode:'US',social:{shareApproximateLocation:true}},globalPresenceCountryCode:'',globalPresenceVerifiedAt:0},
    localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
    startWebGlobalPresence:()=>calls.push('start'),stopWebGlobalPresence:async()=>calls.push('stop'),navigator:{permissions:{query:async()=>({state:'prompt'})}},shareGlobalCountry:async()=>calls.push('verify')};
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function globalCountryStorageKey()'),app.indexOf('function globalPresenceProfilePayload()')),context);
  return {context,calls,stored};
}

test('US profile and legacy cache never override current Colombian device coordinates', async () => {
  const {context,calls} = clientFixture();
  await context.resumeGlobalPresenceFromProfile(); assert.deepEqual(calls,['stop']);
  assert.equal(context.countryCodeFromApproximatePosition({coords:{latitude:4.71,longitude:-74.07}}),'CO');
  context.rememberGlobalCountryCode('CO'); assert.equal(context.storedGlobalCountryCode(),'CO');
  await context.resumeGlobalPresenceFromProfile(); assert.equal(calls.at(-1),'start');
});

test('location permission alone never renews GPS presence automatically', async () => {
  const {context,calls} = clientFixture();
  await context.refreshGrantedGlobalLocation(); assert.equal(calls.length,0);
  context.navigator.permissions.query=async()=>({state:'granted'});
  await context.refreshGrantedGlobalLocation(); assert.deepEqual(calls,[]);
  context.state.profile.social.shareApproximateLocation=false;
  await context.refreshGrantedGlobalLocation(); assert.equal(calls.length,0);
});

test('server cannot restore expired or removed countries from active audio listeners', () => {
  let time = Date.now(); const store = createProductStore({now:()=>new Date(time)});
  const account = store.createAccount({email:'geo@example.com',password:'country-test-password',displayName:'Geo'}).account;
  store.updateAccountProfile(account.id,{displayName:'Geo',visible:true,social:{shareApproximateLocation:true}});
  store.setGlobalRaveCountry(account.id,'CO',time,'gps'); assert.equal(store.globalRavePresenceForAccount(account.id).countryCode,'CO');
  time+=1800000; assert.equal(store.globalRavePresenceForAccount(account.id),null);
  assert.throws(()=>store.setGlobalRaveCountry(account.id,'US',time-1800000,'gps'),/Actualiza/);
  store.setGlobalRaveCountry(account.id,'CO',time,'gps'); store.clearGlobalRaveCountry(account.id);
  assert.equal(store.globalRavePresenceForAccount(account.id),null);
});

test('Docker keeps public country geometry while excluding private root data', () => {
  const ignore=fs.readFileSync(path.join(__dirname,'../.dockerignore'),'utf8').split(/\r?\n/);
  assert.ok(ignore.includes('/data')); assert.ok(!ignore.includes('data'));
});

test('country taps keep their click target; pointer capture starts only for dragging', () => {
  const handlers={}, captures=[];
  const svg={dataset:{},addEventListener:(name,fn)=>handlers[name]=fn,setPointerCapture:id=>captures.push(id),getBoundingClientRect:()=>({width:1000,height:500})};
  const viewport={classList:{add(){},remove(){}}}, tooltip={dataset:{}};
  const context={state:{globalMapView:{width:1000,height:500}},byId:id=>id==='globalRaveMap'?svg:id==='globalRaveMapViewport'?viewport:id==='globalMapTooltip'?tooltip:{addEventListener(){}},renderGlobalRaveCountries(){},renderGlobalRaveCapitals(){},applyGlobalMapView(){},document:{addEventListener(){}},cancelAnimationFrame(){}};
  vm.createContext(context);vm.runInContext(app.slice(app.indexOf('function initializeGlobalRaveMap()'),app.indexOf('async function loadGlobalRave(')),context);context.initializeGlobalRaveMap();
  handlers.pointerdown({button:0,pointerId:1,clientX:100,clientY:100,pointerType:'mouse'});
  handlers.pointermove({pointerId:1,clientX:101,clientY:100,pointerType:'mouse'});
  assert.deepEqual(captures,[]);
  handlers.pointermove({pointerId:1,clientX:110,clientY:100,pointerType:'mouse'});
  assert.deepEqual(captures,[1]);assert.equal(context.state.globalMapPointer.moved,true);
});

function shareFixture({denied=false}={}) {
  const {context,calls}=clientFixture(), requests=[];
  Object.assign(context,{byId:()=>({textContent:''}),renderGlobalPresenceControl(){},nativeGpsCountryCode:()=>denied?Promise.reject(Object.assign(new Error('denied'),{code:1})):Promise.resolve('CO'),
    browserGpsLocation:async()=>{if(denied)throw Object.assign(new Error('denied'),{code:1});return {coords:{latitude:4.71,longitude:-74.07,accuracy:30},timestamp:Date.now()};},
    api:async(url,options)=>{requests.push({url,...options});return {profile:context.state.profile};},
    globalPresenceProfilePayload:()=>({social:{shareApproximateLocation:true}}),renderAccount(){},selectGlobalRaveCountry:code=>calls.push(code),loadGlobalRave:async()=>{},toast(){},globalCountryName:code=>code,showView(){}});
  vm.runInContext(app.slice(app.indexOf('async function verifiedGpsCountryCode()'),app.indexOf('function globalCountryStorageKey()')),context);
  vm.runInContext(app.slice(app.indexOf('async function shareGlobalCountry()'),app.indexOf('function profileResidence(')),context);
  return {context,requests,calls};
}

test('explicit device verification replaces US with CO and transmits no coordinates',async()=>{
  const {context,requests,calls}=shareFixture();await context.shareGlobalCountry();
  const body=JSON.parse(requests.find(r=>r.url==='/api/global-rave/presence').body);
  assert.equal(body.countryCode,'CO');assert.ok(Number.isFinite(body.verifiedAt));
  assert.deepEqual(Object.keys(body).sort(),['countryCode','verifiedAt','verifiedBy']);assert.ok(calls.includes('CO'));
});

test('denied device location does not publish the old country or silently substitute a region',async()=>{
  const {context,requests,calls}=shareFixture({denied:true});context.rememberGlobalCountryCode('US');
  await context.shareGlobalCountry();assert.equal(requests.length,0);assert.equal(context.storedGlobalCountryCode(),'');
  assert.ok(calls.includes('stop'));assert.match(context.state.globalPresenceError,/Autoriza/);
});



test('browser and Windows system geolocation never substitute for confirmed GPS',async()=>{
  const {context,requests}=shareFixture();context.nativeGpsCountryCode=()=>null;
  let browserCalls=0;context.browserGpsLocation=async()=>{browserCalls++;return {coords:{latitude:4.71,longitude:-74.07,accuracy:5}};};
  await context.shareGlobalCountry();assert.equal(browserCalls,0);assert.equal(requests.length,0);assert.match(context.state.globalPresenceError,/GPS confirmado/);
});

test('private profiles cannot request GPS or publish presence',async()=>{
  const {context,requests}=shareFixture();context.state.profile.visible=false;
  let gpsCalls=0;context.nativeGpsCountryCode=()=>{gpsCalls++;return Promise.resolve('CO');};
  await context.shareGlobalCountry();assert.equal(gpsCalls,0);assert.equal(requests.length,0);assert.match(context.state.globalPresenceError,/público/);
});

test('server refuses private, network-derived, missing-source and missing-timestamp records',()=>{
  const store=createProductStore();const person=store.createAccount({email:'gps-only@example.com',password:'gps-password-123',displayName:'GPS'}).account;
  store.updateAccountProfile(person.id,{visible:true,social:{shareApproximateLocation:true}});
  for(const source of [undefined,'wifi','ip','default'])assert.throws(()=>store.setGlobalRaveCountry(person.id,'CO',Date.now(),source),/GPS/);
  assert.throws(()=>store.setGlobalRaveCountry(person.id,'CO',undefined,'gps'),/Actualiza/);
  store.setGlobalRaveCountry(person.id,'CO',Date.now(),'gps');assert.equal(store.globalRavePresenceForAccount(person.id).countryCode,'CO');
  store.updateAccountProfile(person.id,{visible:false,social:{shareApproximateLocation:true}});assert.equal(store.globalRavePresenceForAccount(person.id),null);
  assert.throws(()=>store.setGlobalRaveCountry(person.id,'CO',Date.now(),'gps'),/público/);
  store.updateAccountProfile(person.id,{visible:true,social:{shareApproximateLocation:true}});assert.equal(store.globalRavePresenceForAccount(person.id),null);
});

test('legacy countries without GPS provenance cannot activate the locator',()=>{
  const now=Date.now();assert.equal(location.freshCountry({code:'CO',verifiedAt:now},now),'');
  assert.equal(location.freshCountry({code:'CO',verifiedAt:now,verifiedBy:'wifi'},now),'');
});

test('Android bridge accepts GPS and rejects network sources or low accuracy',async()=>{
  async function request(detail){
    let listener;const context={isNativeAndroidApp:()=>true,Date,Math,Number,Promise,setTimeout,clearTimeout,countryCodeFromApproximatePosition:()=> 'CO',
      window:{addEventListener:(name,fn)=>{listener=fn;},removeEventListener(){},QSessionNativeBridge:{requestGpsCountry:id=>queueMicrotask(()=>listener({detail:{requestId:id,countryCode:'CO',...detail}}))}}};
    vm.createContext(context);vm.runInContext(app.slice(app.indexOf('function nativeGpsCountryCode()'),app.indexOf('async function verifiedGpsCountryCode()')),context);
    return context.nativeGpsCountryCode();
  }
  assert.equal(await request({verifiedBy:'gps',accuracy:15}),'CO');
  for(const detail of [{verifiedBy:'wifi',accuracy:5},{verifiedBy:'gps',accuracy:50000},{verifiedBy:'gps'}])await assert.rejects(request(detail),/GPS/);
});


test('using phone GPS preserves the original verification time and rejects expired records',async()=>{
  const {context}=shareFixture();const verifiedAt=Date.now()-600000;
  context.isNativeAndroidApp=()=>false;
  context.api=async()=>({countryCode:'CO',verifiedBy:'gps',verifiedAt});
  vm.runInContext(app.slice(app.indexOf('async function useAccountGpsCountry()'),app.indexOf('async function shareGlobalCountry()')),context);
  await context.useAccountGpsCountry();assert.equal(context.state.globalPresenceCountryCode,'CO');assert.equal(context.state.globalPresenceVerifiedAt,verifiedAt);
  context.forgetGlobalCountryCode();context.api=async()=>({countryCode:'US',verifiedBy:'gps',verifiedAt:Date.now()-1800001});
  await context.useAccountGpsCountry();assert.equal(context.storedGlobalCountryCode(),'');assert.match(context.state.globalPresenceError,/caducó/);
});
