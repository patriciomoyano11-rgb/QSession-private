"""Read only bounded error classifications, never tokens, URLs or bodies."""
import base64
import subprocess

script=r'''
import json,urllib.request,urllib.parse,urllib.error,pathlib,asyncio,aiohttp,re,ssl
token=json.loads(pathlib.Path('/root/qsession-load-tokens.json').read_text())[0]
url='https://qsession-live.patriciomoyano11.workers.dev/live/PRB10A-hWrdBkirH_2yHmZ9lp/index.m3u8?'+urllib.parse.urlencode({'qsat':token})
req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 QSessionAuthorizedSyntheticLoad/2.0','Origin':'https://qsession.org'})
try: response=urllib.request.urlopen(req,timeout=8)
except urllib.error.HTTPError as error: response=error
body=response.read(65536).decode('utf-8',errors='replace')
known=['Acceso de reproducción denegado','Acceso de reproducción no válido o vencido','La admisión ha finalizado','No se pudo comprobar el aforo; vuelve a intentarlo','La señal todavía no está disponible']
print(json.dumps({'status':response.status,'contentType':response.headers.get('Content-Type'),'admissionFailure':response.headers.get('X-QSession-Admission-Failure'),'cloudflareMitigated':response.headers.get('cf-mitigated'),'knownWorkerError':next((s for s in known if body==s),None),'cloudflare1010':'1010' in body,'cloudflare1020':'1020' in body,'isHtml':'<html' in body.lower(),'bodyBytes':len(body)}))
async def check_async(standard_context=False):
    context=ssl.create_default_context()
    if standard_context:
        context.set_alpn_protocols(['http/1.1'])
        context.post_handshake_auth=True
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=context),headers={'User-Agent':'Mozilla/5.0 QSessionAuthorizedSyntheticLoad/2.0','Origin':'https://qsession.org'}) as session:
        async with session.get(url,allow_redirects=False,timeout=aiohttp.ClientTimeout(total=8)) as r:
            b=(await r.content.read(65536)).decode(errors='replace')
            print(json.dumps({'client':'aiohttp','standardHttp11TlsContext':standard_context,'status':r.status,'contentType':r.headers.get('Content-Type'),'cloudflareMitigated':r.headers.get('cf-mitigated'),'cloudflareErrorCodes':sorted(set(re.findall(r'\b1[0-9]{3}\b',b))),'isHtml':'<html' in b.lower(),'bodyBytes':len(b),'bodyMentionsRateLimit':'rate limit' in b.lower(),'bodyMentionsBrowser':'browser' in b.lower(),'bodyMentionsDenied':'denied' in b.lower()}))
asyncio.run(check_async())
asyncio.run(check_async(True))
'''
encoded=base64.b64encode(script.encode()).decode()
command='python3 -c "import base64;exec(base64.b64decode(\''+encoded+'\'))"'
args=['ssh','-T','-i','C:/Users/maria/.ssh/qsession_deploy_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12','root@45.76.25.22',command]
subprocess.run(args,check=True)
