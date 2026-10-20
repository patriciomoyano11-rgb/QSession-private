'use strict';
const path=require('node:path');
const {createQsessionServer}=require('../server');
const base=path.join(__dirname,'../tmp/music-preview');
const app=createQsessionServer({env:{},port:8098,dataFile:path.join(base,'state.json'),analyticsDataFile:path.join(base,'analytics.ndjson')});
app.server.listen(8098,'127.0.0.1',()=>console.log('Music preview: http://127.0.0.1:8098'));
