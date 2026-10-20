"""Reconcile public local evidence only; never marks production ready."""
import datetime
import json
import pathlib

root=pathlib.Path(__file__).resolve().parents[2]
release=root/'release'
load=json.loads((release/'hls-10000-custom-domain-20261018.json').read_text())
execution=json.loads((release/'custom-domain-load-execution-20261018.json').read_text())
inventory=json.loads((release/'load-generators-custom-domain-20261018.json').read_text(encoding='utf-8-sig'))
event=json.loads((release/'event-5JZGUH-prepared-20261018.json').read_text(encoding='utf-8-sig'))
if inventory['activeCount']!=0 or any(not n['destroyed'] for n in inventory['generators']):raise ValueError('Resources remain')
report={
    'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'roomCode':'5JZGUH','capacityCertified':False,'massModeActive':False,
    'httpDeliveryChecksPassed':load['summary']['httpDeliveryChecksPassed'],
    'counts':load['summary']['counts'],
    'incompleteWorkerReports':sum('report' not in w for n in load['nodeResults'] for w in n.get('nodeReport',{}).get('workers',[])),
    'interpretation':'Failed HTTP load: DDoS Managed Challenge observed in Cloudflare. One worker report missing; zero aggregate peak is not zero media delivered. No sustained 10000 validation.',
    'cloudflareEvent':{'service':'HTTP DDoS','action':'Managed Challenge','host':'live.qsession.org',
        'method':'GET','path':'/live/PRB10A-hWrdBkirH_2yHmZ9lp/index.m3u8',
        'rulesetId':'4d21379b4f9f4bb088e0729962c8b3cf','ruleId':'0a07c24f3cd44a57a5c19b73d2f294d7',
        'rayId':'a4cc0250a8ab4792','observedLocalTime':'2026-10-18T20:28:57-05:00',
        'queryStringExcluded':True,'securitySettingsChanged':False},
    'cleanup':{'leaseCleanupExitCode':execution['leaseCleanupExitCode'],
        'activeAfter':execution['leaseCleanup'][0]['activeAfter'],
        'privateGeneratorFilesRemoved':all(x.get('privateLeaseFileRemoved') for x in execution['leaseCleanup'][1:]),
        'syntheticStorageCleanupComplete':execution['origin']['cleanupComplete'],
        'temporaryGeneratorsRemaining':0},
    'observedTotalTestComputeUsd':inventory['observedTotalTestComputeUsd'],
    'finalInvoiceConfirmed':False,'eventPlan':event,
}
(release/'custom-domain-load-review-20261018.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
path=release/'broadcast-10000-provisioning-20261018.json'
provision=json.loads(path.read_text(encoding='utf-8-sig'))
provision.update(selectedEventRoom='5JZGUH',event10000Prepared=True,event10000Effective=False,
    eventPlanExpiresAt=event['expiresAt'],protectedCustomDomainPilotPassed=True,
    distributedCustomDomainLoadExecuted=True,distributedCustomDomainLoadPassed=False,
    temporaryLoadGeneratorsRemaining=0,observedTotalTestComputeUsd=2.45,
    pending=['Resolve HTTP DDoS false positive with reviewed scope before another load',
             'Confirm actual DJ source in 5JZGUH and validate protected path on Android/Windows/web',
             'Complete same-client encoder recovery and playback alert delivery evidence',
             'Complete truthful readiness; only then activate selected room at 10000'])
path.write_text(json.dumps(provision,indent=2),encoding='utf-8')
path=root/'platform/docs/BROADCAST-10000.md'
text=path.read_text(encoding='utf-8')
start=text.index('JNTUBY conserva');end=text.index('\n\n## DNS',start)
text=text[:start]+('El usuario seleccionó expresamente **5JZGUH**. El permiso operativo para 10.000 ya está preparado '
    'para su ID exacto `room_176b7474-ad51-4390-b013-4e9e05bc2ad8`, sustituyendo el permiso preparado de JNTUBY. '
    'Caduca el 20 de octubre a las 01:33:51 UTC (19 de octubre, 20:33 en Colombia). Sigue sin ser efectivo: '
    'la app continúa en interactive. Se conservaron los campos comerciales, imagen y trabajos de medios; '
    'sólo se reinició la API para cargar la configuración privada. Informe: `release/event-5JZGUH-prepared-20261018.json`.')+text[end:]
text=text.replace('| Piloto protegido anterior | Un cliente durante 29 s; renovación y liberación, sin errores | Hostname workers.dev; repetir sobre live.qsession.org |',
    '| Piloto protegido live.qsession.org | 29 s; 14 manifiestos, 5 segmentos, cero errores; renovación +28,427 s y liberación a cero | Un cliente HTTP sintético; no decodificación ni carga |')
text=text.replace('## Carga distribuida: ejecutada, fallida','## Carga distribuida: intentos anteriores y repetición fallida')
marker='## Pendiente antes de activar 10.000'
paragraph=('### Repetición en live.qsession.org\n\n'
    'Se ejecutó otro ensayo con siete generadores de 8 vCPU en Chicago, Dallas y Nueva Jersey. '
    'Redis mantuvo las 10.000 concesiones, pero la entrega falló: 22.948 denegaciones HTML registradas, '
    '386 segmentos tardaron más de 6 s y faltó el informe de un proceso. Se descargaron 47.537 segmentos '
    '(68.054.919.940 bytes) en los informes recibidos. El pico agregado cero significa que no había una '
    'muestra completa de todos los procesos, no que no se entregó audio/video. No certificar este ensayo.\n\n'
    'Cloudflare mostró HTTP DDoS / Managed Challenge para GET del manifiesto técnico en live.qsession.org; '
    'regla `0a07c24f3cd44a57a5c19b73d2f294d7`. No se modificó la protección. No hubo saturación sostenida '
    'de CPU en los procesos con informe; no se obtuvo una referencia fiable del límite de NIC. '
    'Todos los temporales se retiraron; accesos a cero, archivos privados y objetos sintéticos eliminados. '
    'Cómputo observado acumulado US$2,45, sujeto a factura final y dentro del mismo máximo US$5. '
    'Informes: `release/custom-domain-load-review-20261018.json`, '
    '`release/hls-10000-custom-domain-20261018.json`, `release/load-generators-custom-domain-20261018.json`.\n\n')
text=text.replace(marker,paragraph+marker)
text=text.replace('1. Renovar la configuración técnica PRB10A caducada y repetir el piloto protegido sobre live.qsession.org. No tocar la fuente de ningún DJ al hacerlo.',
    '1. El piloto protegido pasó y PRB10A se renovó hasta el 19 a las 02:09:08 UTC. Resolver el falso positivo HTTP DDoS antes de repetir carga; renovar la señal técnica si vuelve a caducar.')
text=text.replace('5. Confirmar la sala elegida, renovar el permiso si caduca', '5. La sala elegida es 5JZGUH; renovar el permiso si caduca')
text=text.replace('--room JNTUBY','--room 5JZGUH')
path.write_text(text,encoding='utf-8')
print(json.dumps({'evidenceReconciled':True,'room':'5JZGUH','temporaryGeneratorsRemaining':0,'capacityCertified':False}))
