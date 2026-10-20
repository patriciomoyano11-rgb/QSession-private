"""Single 90-second synthetic AV publisher; no user microphone, camera or music."""
import asyncio
import json
import math
import pathlib
import time
import numpy as np
from livekit import rtc

async def main():
    probe = json.loads(pathlib.Path('/opt/qsession-encoder/private/probe.json').read_text())
    room = rtc.Room()
    await room.connect(probe['url'], probe['token'], rtc.RoomOptions(auto_subscribe=False))
    audio = rtc.AudioSource(48000, 2)
    video = rtc.VideoSource(1280, 720)
    await room.local_participant.publish_track(rtc.LocalAudioTrack.create_audio_track('synthetic-audio', audio),rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
    options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA,simulcast=False)
    options.video_encoding.max_bitrate = 1800000
    options.video_encoding.max_framerate = 30
    await room.local_participant.publish_track(rtc.LocalVideoTrack.create_video_track('synthetic-video', video),options)
    start = time.monotonic()
    async def sound():
        samples = 960
        counter = 0
        while time.monotonic()-start < 90:
            t = (np.arange(samples)+counter)/48000
            wave = (np.sin(2*math.pi*440*t)*1600).astype(np.int16)
            stereo = np.repeat(wave[:,None],2,axis=1).tobytes()
            await audio.capture_frame(rtc.AudioFrame(stereo,48000,2,samples))
            counter += samples
    async def picture():
        image = np.zeros((720,1280,4),dtype=np.uint8)
        image[:,:,3] = 255
        count = 0
        while time.monotonic()-start < 90:
            image[:,:,:3] = (20,70,100)
            x = (count*12)%1200
            image[:,x:x+80,:3] = (70,190,170)
            video.capture_frame(rtc.VideoFrame(1280,720,rtc.VideoBufferType.RGBA,image.tobytes()))
            count += 1
            await asyncio.sleep(max(0,start+count/30-time.monotonic()))
    print(json.dumps({'publisherConnected':True,'synthetic':True,'width':1280,'height':720,'durationSeconds':90}),flush=True)
    try:
        await asyncio.gather(sound(),picture())
    finally:
        await room.disconnect()
    print(json.dumps({'publisherDisconnected':True}),flush=True)

asyncio.run(main())
