"""240-second synthetic AV source for the private disposable LiveKit network."""
import asyncio
import json
import math
import pathlib
import socket
import time
import numpy as np
from livekit import rtc

ROOT=pathlib.Path('/root/qsession-recovery-20261018')


async def main():
    if socket.gethostname()!='qsession-load-20261018-cf2-chi1':raise ValueError('Scope')
    probe=json.loads((ROOT/'publisher.json').read_text())
    room=rtc.Room()
    await room.connect(probe['url'],probe['token'],rtc.RoomOptions(auto_subscribe=False))
    audio=rtc.AudioSource(48000,2);video=rtc.VideoSource(1280,720)
    await room.local_participant.publish_track(rtc.LocalAudioTrack.create_audio_track('synthetic-audio',audio),rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
    options=rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA,simulcast=False)
    options.video_encoding.max_bitrate=1800000;options.video_encoding.max_framerate=30
    await room.local_participant.publish_track(rtc.LocalVideoTrack.create_video_track('synthetic-video',video),options)
    start=time.monotonic()
    async def sound():
        counter=0
        while time.monotonic()-start<240:
            t=(np.arange(960)+counter)/48000
            wave=(np.sin(2*math.pi*440*t)*1600).astype(np.int16)
            await audio.capture_frame(rtc.AudioFrame(np.repeat(wave[:,None],2,axis=1).tobytes(),48000,2,960));counter+=960
    async def picture():
        image=np.zeros((720,1280,4),dtype=np.uint8);image[:,:,3]=255;count=0
        while time.monotonic()-start<240:
            image[:,:,:3]=(20,70,100);x=(count*12)%1200;image[:,x:x+80,:3]=(70,190,170)
            video.capture_frame(rtc.VideoFrame(1280,720,rtc.VideoBufferType.RGBA,image.tobytes()));count+=1
            await asyncio.sleep(max(0,start+count/30-time.monotonic()))
    print(json.dumps({'syntheticPublisherReady':True,'durationSeconds':240}),flush=True)
    try:await asyncio.gather(sound(),picture())
    finally:await room.disconnect()


if __name__=='__main__':asyncio.run(main())
