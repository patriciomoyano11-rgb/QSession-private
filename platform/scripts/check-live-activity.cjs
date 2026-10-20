'use strict';

// Run on the app container. Only aggregate activity leaves the server.
const {EgressClient, RoomServiceClient} = require('livekit-server-sdk');
const env = process.env;
const url = (env.LIVEKIT_URL || env.LIVEKIT_PUBLIC_URL || '').replace(/^ws/, 'http');
Promise.all([
  new EgressClient(url, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).listEgress({active: true}),
  new RoomServiceClient(url, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).listRooms(),
]).then(([egress, rooms]) => {
  console.log(JSON.stringify({
    activeEgress: egress.length,
    rooms: rooms.length,
    participants: rooms.reduce((total, room) => total + Number(room.numParticipants || 0), 0),
  }));
}).catch(() => {
  console.error('Could not verify aggregate media activity.');
  process.exitCode = 1;
});
