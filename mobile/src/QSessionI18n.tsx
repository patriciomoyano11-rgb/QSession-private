import React, {createContext, ReactNode, useContext, useEffect, useMemo, useState} from 'react';
import {
  NativeModules,
  Platform,
  Pressable as NativePressable,
  PressableProps,
  Text as NativeText,
  TextInput as NativeTextInput,
  TextInputProps,
  TextProps,
} from 'react-native';

export type QSessionLanguage = 'es' | 'en';

const english: Record<string, string> = {
  'Escuchar':'Listen','Transmitir como DJ':'Broadcast as DJ','Organizar un evento':'Organize an event',
  'Entra con el código de una sala y escucha audio en vivo.':'Enter a room code and listen to live audio.',
  'Crea la sala desde el panel QSession de tu computador.':'Create the room from QSession on your computer.',
  'Prepara el transmisor y comparte el QR con los asistentes.':'Prepare the broadcaster and share the QR with attendees.',
  'Escanear código QR':'Scan QR code','La forma más rápida de entrar.':'The fastest way to join.',
  'Pegar enlace':'Paste link','Usa la invitación del organizador.':'Use the organizer’s invitation.',
  'Escribir código':'Enter code','Ingresa las seis letras o números.':'Enter the six letters or numbers.',
  'Normal':'Normal','Auriculares':'Headphones','Auriculares sensibles':'Sensitive headphones',
  'Lista':'Ready','Conectando':'Connecting','Preparando audio':'Preparing audio','En vivo':'Live','Reconectando':'Reconnecting',
  'Finalizada':'Ended','Sin conexión':'Offline','Perfil':'Profile','Mi perfil':'My profile','Crear mi perfil':'Create my profile',
  'Cerrar visión':'Close vision','Abrir visión de Q Session':'Open Q Session vision','NUESTRA VISIÓN':'OUR VISION','VISIÓN':'VISION',
  'Hacer bailar al mundo entero.':'Make the whole world dance.','Hacer bailar al mundo entero':'Make the whole world dance',
  'Q Session nace para llevar una experiencia inmersiva a cada oyente, sin importar dónde esté.':'Q Session was born to bring an immersive experience to every listener, wherever they are.',
  'Queremos que la música, la imagen y la energía de una sesión viajen en vivo y conviertan cada teléfono en una puerta al evento.':'We want the music, visuals, and energy of a session to travel live and turn every phone into a doorway to the event.',
  'Una sesión. Todos conectados. El mundo en movimiento.':'One session. Everyone connected. The world in motion.',
  'Bailar para volver al centro.':'Dance to return to your center.','Una rave global para abrazar a la Tierra en un solo baile.':'A global rave to embrace the Earth in one dance.','“Usa el baile como terapia.”':'“Use dance as therapy.”',
  'Personas de todo el mundo bailando juntas.':'People around the world dancing together.','Baile y liberación':'Dance and liberation','El movimiento como terapia para una vida más plena.':'Movement as therapy for a fuller life.',
  'Energía que se comparte':'Energy we share','La energía del baile nos conecta y nos transforma.':'The energy of dance connects and transforms us.','Amor a la Tierra':'Love for the Earth','Un baile global por un planeta más consciente.':'A global dance for a more conscious planet.',
  'TECNOLOGÍA PARA COMPARTIR PRESENCIA':'TECHNOLOGY FOR SHARING PRESENCE','Cualquier teléfono puede convertirse en una ventana al vivo.':'Any phone can become a window into a live experience.',
  'Q Session convierte teléfonos, computadoras y pantallas en dispositivos capaces de recibir audio y video en tiempo real, desde cualquier lugar.':'Q Session turns phones, computers, and screens into devices that receive live audio and video from anywhere.',
  'Audio en vivo':'Live audio','Video en vivo':'Live video','Sincronización':'Synchronization','Acceso global':'Global access','DJ · Profesor · Anfitrión':'DJ · Teacher · Host','TRANSMITIENDO EN VIVO':'BROADCASTING LIVE',
  'MUCHO MÁS QUE UNA FIESTA':'MUCH MORE THAN A PARTY','Una plataforma para encuentros que necesitan sentirse presentes.':'A platform for gatherings that need to feel present.','Sesiones privadas':'Private sessions','Comparte una experiencia íntima en tiempo real.':'Share an intimate experience in real time.',
  'Grupos y comunidades':'Groups and communities','Reúne personas alrededor de un propósito común.':'Bring people together around a shared purpose.','Yoga y meditación':'Yoga and meditation','Guía prácticas audiovisuales desde cualquier lugar.':'Guide audiovisual practices from anywhere.',
  'Bodas y celebraciones':'Weddings and celebrations','Conecta a quienes no pueden estar físicamente.':'Connect those who cannot be there in person.','Conferencias':'Conferences','Transmite ideas con participación en vivo.':'Share ideas with live participation.','Un mismo baile conectando países y culturas.':'One dance connecting countries and cultures.',
  'Q Session es infraestructura para compartir presencia.':'Q Session is infrastructure for sharing presence.','No es solamente una fiesta. Es una herramienta para que las personas escuchen, vean y vivan juntas una experiencia en tiempo real.':'It is not just a party. It is a tool for people to listen, watch, and experience something together in real time.','Tecnología al servicio de la conexión humana.':'Technology in service of human connection.',
  'TIPO DE SESIÓN':'SESSION TYPE','Conferencia':'Conference','Boda':'Wedding','Cumpleaños':'Birthday','Baby shower':'Baby shower','Personalizada':'Custom',
  'Experiencia y diseño':'Experience and design','ESTILO VISUAL':'VISUAL STYLE','MOVIMIENTO VISUAL':'VISUAL MOTION',
  'Nocturno':'Night','Serenidad':'Serenity','Institucional':'Institutional','Celebración':'Celebration','Minimalista':'Minimal','Calmo':'Calm','Equilibrado':'Balanced','Inmersivo':'Immersive',
  'Creador IA':'AI creator','Filtros, máscaras y disfraces a partir de indicaciones.':'Filters, masks, and costumes from instructions.','Visuales VJ':'VJ visuals','Efectos visuales para acompañar la señal.':'Visual effects that accompany the signal.',
  'Videos de participantes':'Participant videos','Envíos para el anfitrión o la sala.':'Submissions for the host or the room.','Videos de saludo':'Greeting videos','Felicitaciones y mensajes para celebraciones.':'Greetings and messages for celebrations.',
  'Al anfitrión':'To the host','Entrega privada para revisión.':'Private delivery for review.','A la sala':'To the room','Puede proponerse para el espacio público.':'Can be proposed for the public space.','Envío privado':'Private submission','Sólo el anfitrión lo ve hasta aprobarlo.':'Only the host sees it until approval.',
  'Música QSession':'QSession music','Escena moderna y sobria con creador IA, visuales VJ y videos del público.':'A modern, understated scene with an AI creator, VJ visuals, and audience videos.',
  'Atmósfera de paz y equilibrio, sin filtros ni disfraces; permite videos públicos o privados.':'A peaceful, balanced atmosphere without filters or costumes; public or private videos are supported.',
  'Diseño institucional QSession para ponentes, cámaras y conversación profesional.':'Institutional QSession design for speakers, cameras, and professional conversation.',
  'Celebración armónica con videos de saludo de los invitados.':'A harmonious celebration with guest greeting videos.','Celebración elegante con videos de felicitación para el anfitrión o la sala.':'An elegant celebration with greeting videos for the host or room.','Una experiencia suave y cercana con saludos de familia y amistades.':'A gentle, intimate experience with greetings from family and friends.','Sala personalizada':'Custom room','Todos los controles quedan disponibles para construir una experiencia propia.':'All controls are available to build your own experience.',
  'Música en vivo, cámaras y comunidad alrededor de una misma señal.':'Live music, cameras, and community around one shared signal.','Prácticas de yoga, respiración y meditación con participación tranquila.':'Yoga, breathwork, and meditation practices with calm participation.','Una presentación central con conversación y conexiones profesionales opcionales.':'A central presentation with conversation and optional professional connections.',
  'Una celebración íntima para acompañar a la pareja desde cualquier lugar.':'An intimate celebration to accompany the couple from anywhere.','Invitados, saludos y momentos compartidos en una celebración en vivo.':'Guests, greetings, and shared moments in a live celebration.','Familia y amistades reunidas para compartir el momento y sus detalles.':'Family and friends gathered to share the moment and their gifts.','Configura libremente la privacidad y la participación.':'Configure privacy and participation freely.',
  'FUNCIONES OPCIONALES':'OPTIONAL FEATURES','Activa únicamente las que quieras usar.':'Enable only the features you want to use.','Cámaras de usuarios':'Participant cameras','Perfiles visibles':'Visible profiles','Matchmaking abierto':'Open matchmaking','Detalles':'Gifts',
  'Mensajes durante la sesión.':'Messages during the session.','Cada persona decide si quiere aparecer.':'Each person decides whether to appear.','Identidad y conexiones dentro de la sala.':'Identity and connections inside the room.','Afinidades y toques entre perfiles.':'Shared interests and nudges between profiles.','Gestos simbólicos entre personas.':'Symbolic gestures between people.',
  'TU IDENTIDAD EN QSESSION':'YOUR QSESSION IDENTITY','Tú decides qué mostrar y cómo podrán conectar contigo en los eventos.':'You decide what to show and how people can connect with you at events.',
  'Tu nombre o apodo':'Your name or nickname','La foto se reduce y guarda de forma segura en QSession junto con tu perfil.':'Your photo is resized and stored securely in QSession with your profile.',
  'Cambiar foto':'Change photo','Elegir foto':'Choose photo','Quitar':'Remove','NOMBRE O APODO':'NAME OR NICKNAME',
  'Nombre o apodo':'Name or nickname','Cómo quieres que te llamen':'How you want to be known','CIUDAD O REGIÓN · OPCIONAL':'CITY OR REGION · OPTIONAL',
  'Ciudad o región':'City or region','Ej. Medellín, Colombia':'E.g. Medellín, Colombia','INTERESES · OPCIONAL':'INTERESTS · OPTIONAL',
  'Intereses':'Interests','Música electrónica, yoga, baile…':'Electronic music, yoga, dance…',
  'Sepáralos con comas. Servirán para encontrar afinidades cuando habilitemos Matchmaking.':'Separate them with commas. They will help find shared interests when Matchmaking launches.',
  'SOBRE MÍ · OPCIONAL':'ABOUT ME · OPTIONAL','Sobre mí':'About me','Cuéntale a la comunidad lo que quieras sobre ti.':'Tell the community anything you would like about yourself.',
  'Visibilidad del perfil':'Profile visibility','Puedes cambiarla cuando quieras. Escuchar seguirá funcionando sin publicar tus datos.':'You can change it anytime. Listening still works without making your data public.',
  'Privado':'Private','Solo tú lo ves':'Only you can see it','Público':'Public','Visible al participar':'Visible when participating',
  'Perfil público con control':'Public profile with control','Perfil privado':'Private profile',
  'Tu foto, alias, biografía e intereses podrán mostrarse en los eventos. Rave global usa un permiso independiente y nunca publica tu punto exacto.':'Your photo, alias, bio and interests may be shown at events. Global rave uses a separate permission and never publishes your exact point.',
  'Tus datos no se muestran a otros usuarios. Rave global puede contar una zona aproximada sin publicar tu perfil.':'Your information is not shown to other users. Global rave can count an approximate area without publishing your profile.',
  'Cómo quieres conectar':'How you want to connect','Estos permisos preparan tu perfil para las próximas funciones. Todavía no activan contactos ni ubicación.':'These permissions prepare your profile for upcoming features. They do not enable contacts or location yet.',
  'Matchmaking en eventos':'Event matchmaking','Aparecer ante personas con intereses afines.':'Be discoverable by people with shared interests.',
  'Mensajes de asistentes':'Attendee messages','Permitir solicitudes de conversación desde tu perfil.':'Allow conversation requests from your profile.',
  'Ubicación aproximada':'Approximate location','Compartir solo tu ciudad o región; nunca tu dirección.':'Share only your city or region, never your address.','Aparecer en Rave global':'Appear on Global rave','Usa la ubicación aproximada de este dispositivo mientras estás en la sala. Nunca muestra tu punto exacto, nombre ni perfil.':'Uses this device’s approximate location while you are in the room. It never shows your exact point, name, or profile.','Este dato pertenece a tu perfil y no determina el mapa de Rave global.':'This information belongs to your profile and does not determine the Global rave map.',
  'Comunicación con el DJ':'DJ communication','Recibir mensajes o dinámicas del anfitrión.':'Receive messages or activities from the host.',
  'Apoyar al DJ':'Support the DJ','Mostrar la opción de Tip cuando esté disponible.':'Show the Tip option when available.',
  'PRÓXIMAMENTE':'COMING SOON','Un perfil para conectar de verdad':'A profile for meaningful connections','Afinidades':'Shared interests',
  'Conversaciones':'Conversations','Encuentros':'Meetups','Tip al DJ':'Tip the DJ','Guardar mi perfil':'Save my profile','Guardando…':'Saving…','Volver':'Back',
  'Tu evento.':'Your event.','Todos conectados.':'Everyone connected.','Crea tu identidad en QSession o elige cómo quieres participar. Escuchar seguirá funcionando sin perfil.':'Create your QSession identity or choose how you want to participate. Listening still works without a profile.',
  'EN VIVO, SIN FRONTERAS':'LIVE WITHOUT BORDERS','Tu sesión,':'Your session,','todos conectados.':'everyone connected.',
  'Q Session convierte cada teléfono en un receptor audiovisual en vivo.':'Q Session turns every phone into a live audiovisual receiver.',
  'Código, enlace o QR':'Code, link or QR','Crear una sala':'Create a room','Tipo, acceso y participación':'Type, access and participation',
  'CREAR SESIÓN':'CREATE A SESSION','¿Cómo quieres transmitir?':'How would you like to broadcast?',
  'TU QSESSION':'YOUR QSESSION','Una identidad, todos tus dispositivos':'One identity, all your devices',
  'TU SALA AHORA':'YOUR ROOM NOW','Personas activas en':'People active in','esta sala.':'this room.',
  'Sólo aparecen perfiles visibles conectados a tu sesión actual. Al salir, desaparecen de este espacio.':'Only visible profiles connected to your current session appear here. They disappear from this space when they leave.',
  'Toca la imagen de una persona para conectar.':'Tap a person’s image to connect.','Actividad':'Activity','Mosaico':'Grid','Mostrar':'Show',
  'Entra a una sala para ver quién está activo':'Join a room to see who is active','Personas sólo muestra los perfiles presentes en tu sala actual.':'People only shows profiles currently in your room.',
  'CONVERSACIONES':'CONVERSATIONS','Hablar cerca, aunque':'Talk closely, even when','estén lejos.':'far apart.',
  'El chat necesita una identidad':'Chat needs an identity','Inicia sesión para que tus conversaciones pertenezcan a tu cuenta Q Session.':'Sign in so your conversations belong to your Q Session account.',
  'PRESENCIA REAL Y CONSENTIDA':'REAL, CONSENSUAL PRESENCE','Un rave alrededor':'A rave around','del mundo.':'the world.',
  'Cada luz representa una presencia anónima dentro de un país. Nunca mostramos ciudad, identidad ni posición exacta.':'Each light represents an anonymous presence within a country. We never show a city, identity, or exact position.',
  'personas ahora':'people now','países activos':'active countries',
  'La ubicación en vivo provendrá del dispositivo y sólo se compartirá con permiso. Nunca se inventará a partir de la ciudad escrita en un perfil.':'Live location will come from the device and is shared only with permission. It is never inferred from the city written in a profile.',
  'oyentes ahora':'listeners now','capitales activas':'active capitals','Global':'Global',
  'EN VIVO AHORA':'LIVE NOW','Salas activas':'Active rooms','Solo mostramos salas públicas con audio y personas conectadas.':'We only show public rooms with audio and people connected.',
  'Actualizar salas activas':'Refresh active rooms','Buscando salas activas…':'Finding active rooms…','No hay salas transmitiendo ahora.':'No rooms are broadcasting now.',
  'Cuando una sala pública inicie su audio, aparecerá aquí.':'When a public room starts its audio, it will appear here.',
  'Foto, identidad, privacidad e intereses para conectar en eventos.':'Photo, identity, privacy and interests for connecting at events.',
  'MODO OYENTE':'LISTENER MODE','Entrar a una sala':'Join a room','Elige una forma de ingreso. QSession se encargará de localizar la transmisión.':'Choose how to join. QSession will locate the broadcast.',
  'FORMA DE INGRESO':'JOIN METHOD','Elegir forma de ingreso':'Choose how to join','SELECCIONADO':'SELECTED','Escanea la invitación':'Scan the invitation',
  'Apunta la cámara al QR que aparece en la pantalla del organizador.':'Point the camera at the QR shown on the organizer’s screen.',
  'ENLACE DE INVITACIÓN':'INVITATION LINK','Enlace de invitación':'Invitation link','Pega el enlace completo; QSession obtendrá automáticamente la sala.':'Paste the full link; QSession will find the room automatically.',
  'CÓDIGO DE LA SALA':'ROOM CODE','Código de la sala':'Room code','Buscaremos primero la sala mundial en QSession y, si no está allí, en tu red Wi-Fi.':'We will look for the room on QSession first, then on your Wi-Fi network.',
  'Escanear e ingresar':'Scan and join','Ingresar':'Join','No necesitas instalar la app. También puedes escuchar desde la web.':'You do not have to install the app. You can also listen on the web.',
  'EN VIVO':'LIVE','Música':'Music','Chat':'Chat','Audio original':'Original audio','Sin filtros ni compresión adicional. Controla el volumen desde tu dispositivo.':'No extra filters or compression. Control the volume from your device.',
  'VIDEO EN VIVO':'LIVE VIDEO','Pantalla completa':'Full screen','Salir de pantalla completa':'Exit full screen','Ver al DJ en pantalla completa':'View the DJ full screen',
  'Pausar':'Pause','Salir':'Leave','oyentes conectados':'listeners connected','Audio HD':'HD audio','Distribución QSession':'QSession delivery',
  'BIBLIOTECA QSESSION':'QSESSION LIBRARY','Música del evento':'Event music','Artistas, listas y muestras vinculadas a esta experiencia.':'Artists, playlists and previews linked to this experience.',
  'MUESTRAS':'PREVIEWS','ARTISTAS SUGERIDOS':'SUGGESTED ARTISTS','Actualizar':'Refresh','Escuchar muestra':'Play preview','Detener muestra':'Stop preview',
  'Sin muestra':'No preview','Crédito':'Credit','COMUNIDAD':'COMMUNITY','Conversaciones del evento':'Event conversations','Reacciones rápidas y chat en vivo.':'Quick reactions and live chat.',
  'Editar perfil':'Edit profile','Apareces como Oyente. Crea o publica tu perfil si quieres mostrar tu identidad.':'You appear as Listener. Create or publish your profile to show your identity.',
  'Todavía no hay mensajes.':'No messages yet.','Mensaje':'Message','Escribe un mensaje…':'Write a message…','Enviar mensaje':'Send message','Enviar':'Send',
  'Chat de voz':'Voice chat','Llegará en una próxima versión.':'Coming in a future version.','MODO DJ / ORGANIZADOR':'DJ / ORGANIZER MODE',
  'Transmitir desde este teléfono':'Broadcast from this phone','Usa el micrófono o una interfaz USB que Android reconozca como entrada.':'Use the microphone or a USB interface recognized by Android as an input.',
  'NOMBRE DEL EVENTO · OPCIONAL':'EVENT NAME · OPTIONAL','DJ O ANFITRIÓN · OPCIONAL':'DJ OR HOST · OPTIONAL',
  'CÓDIGO PERSONALIZADO · OPCIONAL':'CUSTOM CODE · OPTIONAL','SERVIDOR PÚBLICO O LOCAL · OPCIONAL':'PUBLIC OR LOCAL SERVER · OPTIONAL',
  'Se buscará automáticamente':'Found automatically','Crear sala e iniciar':'Create room and start','Compartir invitación':'Share invitation','Finalizar transmisión':'End broadcast',
  'Abrir Mi perfil':'Open My profile','Crear o editar mi perfil':'Create or edit my profile','Denunciar mensaje':'Report message',
  '¿Quieres enviar este mensaje a revisión?':'Would you like to submit this message for review?','Cancelar':'Cancel','Denunciar':'Report'
};

Object.assign(english, {
  'Las listas ya están creadas. Falta publicar los primeros masters autorizados.':'The playlists are ready. The first authorized masters still need to be published.',
  'No pudimos recuperar el perfil guardado en este teléfono.':'We could not restore the profile saved on this phone.',
  'El reproductor de muestras no está disponible en esta instalación.':'Preview playback is not available in this installation.',
  'La búsqueda automática de salas no está disponible en esta instalación.':'Automatic room discovery is not available in this installation.',
  'El código debe tener seis letras o números.':'The code must contain six letters or numbers.',
  'Comprobando la invitación…':'Checking the invitation…',
  'La función de audio en segundo plano no está disponible en esta instalación.':'Background audio is not available in this installation.',
  'El escáner QR no está disponible en esta instalación.':'The QR scanner is not available in this installation.',
  'No fue posible leer el código QR.':'The QR code could not be read.',
  'El selector de fotos no está disponible en esta instalación.':'Photo selection is not available in this installation.',
  'El almacenamiento del perfil no está disponible en esta instalación.':'Profile storage is not available in this installation.',
  'Perfil guardado en QSession. Será visible cuando participes en un evento.':'Profile saved in QSession. It will be visible when you join an event.',
  'Perfil guardado en QSession como privado. Solo tú decides cuándo hacerlo visible.':'Profile saved privately in QSession. Only you decide when to make it visible.',
  'El perfil quedó guardado en este teléfono, pero falta sincronizarlo con QSession. Revisa tu conexión e inténtalo nuevamente.':'The profile was saved on this phone but could not sync with QSession. Check your connection and try again.',
  'QSession necesita permiso de micrófono para transmitir esta entrada.':'QSession needs microphone permission to broadcast this input.',
  'La búsqueda automática del servidor no está disponible.':'Automatic server discovery is not available.',
  'No fue posible iniciar la transmisión móvil.':'The mobile broadcast could not be started.',
  'Tu foto, alias, biografía e intereses podrán mostrarse en los eventos. La ciudad solo se compartirá si activas el permiso correspondiente.':'Your photo, nickname, bio and interests may appear at events. Your city will only be shared if you enable that permission.',
  'Tus datos no se muestran a otros usuarios. Si activas Rave global, únicamente sumaremos tu ciudad de forma anónima.':'Your data is not shown to other users. If you enable Global rave, only your city is added anonymously.',
  'Tus datos se guardan en QSession, pero no se muestran a otros usuarios y aparecerás como Oyente en el chat.':'Your information is saved in QSession but is not shown to other users, and you will appear as Listener in chat.',
  'QSESSION 1.12 · PRUEBA PRIVADA':'QSESSION 1.12 · PRIVATE BETA',
  'Guardado en QSession':'Saved in QSession',
  'Pega un enlace válido para continuar.':'Paste a valid link to continue.',
  'Escribe el código de seis caracteres para continuar.':'Enter the six-character code to continue.',
  'Escanear y conectar':'Scan and connect','Conectar y escuchar':'Connect and listen','Abriendo cámara…':'Opening camera…',
  'Ya estás escuchando la transmisión.':'You are listening to the broadcast.',
  'Normal conserva la señal original. Si tus auriculares saturan, prueba primero -3 dB.':'Normal preserves the original signal. If your headphones distort, try -3 dB first.',
  'Protección activa solo en este teléfono. La señal original no se procesa ni se comprime.':'Protection is active only on this phone. The original signal is neither processed nor compressed.',
  'oyentes en la sala':'listeners in the room','Conexión directa':'Direct connection','Opus estéreo':'Stereo Opus',
  'DESCUBRIR':'DISCOVER','Artistas, muestras y listas para seguir explorando.':'Artists, previews and playlists to keep exploring.',
  'MUESTRAS · 45 S':'PREVIEWS · 45 S','Los artistas aparecerán cuando sus muestras estén publicadas.':'Artists will appear when their previews are published.',
  'Esta lista está lista para recibir música':'This playlist is ready for music',
  'Cuando publiquemos los primeros masters autorizados, verás aquí el artista, el track y su muestra.':'When the first authorized masters are published, you will see the artist, track and preview here.',
  'Al reproducir una muestra, QSession silencia momentáneamente la sala y vuelve al audio en vivo al terminar.':'When a preview plays, QSession briefly mutes the room and returns to live audio when it ends.',
  'Chat de la sala':'Room chat','Conversa sin perder la música.':'Chat without missing the music.','Crear perfil':'Create profile',
  'Participas de forma privada como Oyente':'You are participating privately as Listener','Aún no hay mensajes. Puedes ser el primero.':'No messages yet. You can be the first.',
  'Salir de la sala':'Leave room','MODO DJ':'DJ MODE','MODO ORGANIZADOR':'ORGANIZER MODE','Transmitir desde Android':'Broadcast from Android',
  'Usa el micrófono o una interfaz USB reconocida por Android. Para aplicaciones o archivos del computador, utiliza el panel web del PC.':'Use the microphone or a USB interface recognized by Android. For computer apps or files, use the web panel on your PC.',
  'Micrófono o entrada USB':'Microphone or USB input','Audio HD sin cancelación de voz':'HD audio without voice processing',
  'Iniciar transmisión móvil':'Start mobile broadcast','¿Quieres transmitir música del PC?':'Would you like to broadcast music from your PC?',
  'Abre QSession Studio en tu computador y utiliza el selector de fuente, el control de nivel o un archivo autorizado.':'Open QSession Studio on your computer and use the source selector, level control or an authorized file.',
  'PREPARANDO SALA':'PREPARING ROOM','Preparando señal':'Preparing signal','Micrófono / USB · Distribución QSession':'Microphone / USB · QSession delivery',
  'Habla con toda la sala o crea una conversación cerrada.':'Talk to the whole room or create a closed conversation.',
  'Sala':'Room','Privados':'Private','Todos los oyentes pueden leer y participar.':'Every listener can read and participate.',
  'Conversaciones privadas':'Private conversations','Habla con una persona o arma un grupo para quienes te acompañan.':'Talk with one person or create a group for the people attending with you.',
  'Cerrar':'Close','+ Nuevo':'+ New','Nuevo chat privado':'New private chat',
  'Selecciona una persona para un chat directo o varias para crear un grupo.':'Select one person for a direct chat or several people to create a group.',
  'Nombre del grupo · opcional':'Group name · optional','Abrir chat':'Open chat',
  'No hay personas disponibles. Cada participante decide si acepta invitaciones desde su perfil.':'No one is available. Each participant decides whether to accept invitations in their profile.',
  'Activa “Mensajes de asistentes” en tu perfil para invitar a otras personas.':'Enable “Attendee messages” in your profile to invite other people.',
  'Tus chats aparecerán aquí':'Your chats will appear here','Son cerrados y sólo participan las personas que aceptan la invitación.':'They are closed and only people who accept the invitation can participate.',
  'Invitación pendiente':'Invitation pending','Conversación lista':'Conversation ready','NUEVA':'NEW',
  'Volver a conversaciones privadas':'Back to private conversations','Conversación privada':'Private conversation','INVITACIÓN PRIVADA':'PRIVATE INVITATION',
  'Te invitaron a un grupo.':'You were invited to a group.','Te invitaron a conversar.':'You were invited to chat.',
  'Sólo quienes acepten podrán leer y escribir en esta conversación.':'Only people who accept can read and write in this conversation.',
  'Rechazar':'Decline','Aceptar':'Accept','Tú':'You','Esta conversación es privada. Escribe el primer mensaje.':'This conversation is private. Write the first message.',
  'Mensaje privado':'Private message','Escribe en privado…':'Write privately…','Enviar mensaje privado':'Send private message',
  'Permitir invitaciones a chats privados y grupos durante el evento.':'Allow invitations to private chats and groups during the event.',
  'Personas':'People','PERSONAS EN ESTA SALA':'PEOPLE IN THIS ROOM','Conecta durante el evento':'Connect during the event',
  'Aquí sólo aparecen quienes decidieron publicar su perfil mientras están conectados.':'Only people who chose to publish their profile while connected appear here.',
  'visibles':'visible','MATCHMAKING':'MATCHMAKING','Posibles conexiones':'Potential connections',
  'Sugerencias privadas basadas únicamente en intereses compartidos.':'Private suggestions based only on shared interests.',
  'afinidades':'matches','Encuentra personas afines':'Find like-minded people',
  'Agrega intereses a tu perfil para descubrir coincidencias.':'Add interests to your profile to discover matches.',
  'Publica tu perfil y activa Matchmaking para recibir sugerencias dentro de la sala.':'Publish your profile and enable Matchmaking to receive suggestions inside the room.',
  'Perfiles publicados':'Published profiles','Todavía no hay perfiles públicos':'There are no public profiles yet',
  'Los oyentes privados no aparecen aquí. Puedes publicar el tuyo desde Perfil cuando quieras.':'Private listeners do not appear here. You can publish yours from Profile whenever you want.',
  'Revisar mi perfil':'Review my profile','TÚ':'YOU','AFINIDAD':'MATCH','En esta sala ahora':'In this room now',
  'Abrir chat privado':'Open private chat','Elige cómo pueden encontrarte y conectar contigo únicamente mientras compartes una sala.':'Choose how people can find and connect with you only while you share a room.',
  'Publica tu perfil y activa “Mensajes de asistentes” para iniciar una conversación.':'Publish your profile and enable “Attendee messages” to start a conversation.',
  'CUENTA QSESSION':'QSESSION ACCOUNT','Cuenta QSession activa':'QSession account active','Cerrar sesión':'Sign out',
  'Tu perfil, galería y preferencias pueden recuperarse en otro dispositivo cuando inicies sesión.':'Your profile, gallery and preferences can be restored on another device when you sign in.',
  'Crea una cuenta para recuperar tu perfil, tus fotos y tus preferencias en cualquier dispositivo.':'Create an account to restore your profile, photos and preferences on any device.',
  'Crear cuenta':'Create account','Iniciar sesión':'Sign in','CORREO ELECTRÓNICO':'EMAIL','Correo electrónico':'Email',
  'CONTRASEÑA':'PASSWORD','Contraseña':'Password','Mínimo 10 caracteres':'At least 10 characters','Crear mi cuenta':'Create my account',
  'Ingresar a QSession':'Sign in to QSession','Procesando…':'Processing…','Tu nombre o apodo':'Your name or nickname',
  'Puedes agregar hasta seis fotos. JPG, PNG y WebP se optimizan antes de guardarse.':'You can add up to six photos. JPG, PNG and WebP are optimized before being saved.',
  'Agregar fotos':'Add photos','PRINCIPAL':'PRIMARY','Hacer principal':'Make primary','Nueva foto principal seleccionada.':'New primary photo selected.',
  'Puedes guardar hasta seis fotos en tu perfil.':'You can save up to six photos in your profile.','No fue posible abrir tus fotos.':'Your photos could not be opened.',
  'Mi Story':'My Story','Comparte un estado durante 24 horas con las personas de tu sala.':'Share a 24-hour status with the people in your room.',
  'ACTIVO POR 24 H':'ACTIVE FOR 24 H','Texto del Story':'Story text','¿Qué energía traes hoy?':'What energy are you bringing today?',
  'Publicar por 24 horas':'Share for 24 hours','Publicando…':'Sharing…','Inicia sesión para publicar Stories.':'Sign in to share Stories.',
  'Activa el perfil público para compartirlo en una sala.':'Make your profile public to share it in a room.',
  'Crea una cuenta o inicia sesión para publicar un Story.':'Create an account or sign in to share a Story.',
  'Activa el perfil público para compartir un Story dentro de la sala.':'Make your profile public to share a Story in the room.',
  'Publicando Story…':'Sharing Story…','Story publicado durante 24 horas. Sólo aparecerá cuando compartas una sala.':'Story shared for 24 hours. It will only appear while you share a room.',
  'No fue posible publicar el Story.':'The Story could not be shared.','STORY':'STORY','AHORA':'NOW',
  'La sesión venció. Tu perfil local sigue guardado en este teléfono.':'Your session expired. Your local profile is still saved on this phone.',
  'Sin conexión. Conservamos tu sesión y tu perfil local hasta recuperar Internet.':'Offline. Your session and local profile will remain saved until the connection returns.',
  'No pudimos leer la cuenta guardada. Tu perfil local permanece en este teléfono.':'The saved account could not be read. Your local profile remains on this phone.',
  'Sesión cerrada. Tu identidad local permanece privada; inicia sesión para recuperar la galería completa.':'Signed out. Your local identity remains private; sign in to restore the full gallery.',
  'MODO SOCIAL · EN VIVO':'SOCIAL MODE · LIVE','Baila con la sala':'Dance with the room',
  'Activa tu cámara frontal sólo cuando quieras aparecer. El micrófono permanece apagado.':'Turn on your front camera only when you choose to appear. Your microphone stays off.',
  'VISIBLE':'VISIBLE','PRIVADO':'PRIVATE','El mosaico espera a la comunidad':'The mosaic is waiting for the community',
  'Las cámaras aparecerán aquí únicamente por decisión de cada oyente.':'Cameras appear here only when each listener chooses to share.',
  'Activar mi cámara frontal':'Turn on my front camera','Apagar mi cámara':'Turn off my camera','Preparando…':'Preparing…',
  'Sólo personas dentro de esta sala pueden recibir el mosaico. QSession la apaga al salir de la app.':'Only people in this room can receive the mosaic. QSession turns your camera off when you leave the app.',
  'Tu cámara está apagada. Sigues escuchando normalmente.':'Your camera is off. You can keep listening normally.',
  'Para aparecer en el mosaico, primero publica tu perfil desde Perfil.':'Publish your profile from Profile before appearing in the mosaic.',
  'El video social está disponible en salas con distribución QSession.':'Social video is available in rooms using QSession distribution.',
  'Preparando tu cámara frontal…':'Preparing your front camera…','Estás visible en el mosaico de esta sala. Tu micrófono permanece apagado.':'You are visible in this room’s mosaic. Your microphone remains off.',
  'La cámara se apagó automáticamente al salir de QSession.':'The camera turned off automatically when you left QSession.',
  'QSESSION 1.24 · PRUEBA PRIVADA':'QSESSION 1.24 · PRIVATE BETA',
  'Creando tu cuenta QSession…':'Creating your QSession account…','Ingresando a QSession…':'Signing in to QSession…',
  'Tu cuenta quedó creada y tu perfil está sincronizado.':'Your account was created and your profile is synchronized.',
  'Sesión iniciada. Recuperamos tu perfil de QSession.':'Signed in. Your QSession profile was restored.',
  'CHAT EN VIVO':'LIVE CHAT','Hablen como si estuvieran cerca':'Talk as if you were together',
  'Sólo entran quienes aceptaron esta conversación.':'Only people who accepted this conversation can join.',
  'El grupo ya está conversando. Entra cuando quieras.':'The group is already talking. Join whenever you like.',
  'Iniciar chat en vivo':'Start live chat','Entrar al chat en vivo':'Join live chat','Silenciar micro':'Mute mic','Abrir micro':'Open mic',
  'Silenciar audio':'Mute audio','Escuchar audio':'Listen','Nota de voz':'Voice message','Reproduciendo…':'Playing…',
  'Grabar nota de voz':'Record voice message','Detener y enviar nota de voz':'Stop and send voice message',
  'Texto, notas de voz y Chat en vivo con las personas que elijas.':'Text, voice messages and Live Chat with the people you choose.',
  'Audio chat privado':'Private audio chat','Envía notas de voz o conversa en vivo con una persona o con el grupo que elijas.':'Send voice messages or talk live with one person or a group you choose.',
  'Abriendo tus fotos…':'Opening your photos…','Activar cámara':'Turn on camera','Apagar mi cámara social':'Turn off my social camera',
  'Buscando el servidor QSession…':'Looking for the QSession server…','Cambiar idioma a inglés':'Switch language to English','Cambiar idioma a español':'Switch language to Spanish',
  'Conectando…':'Connecting…','El chat en vivo necesita permiso del micrófono.':'Live Chat needs microphone permission.',
  'Entrando a la conversación…':'Joining the conversation…','Enviando invitación…':'Sending invitation…',
  'Escribe tu correo y una contraseña de al menos 10 caracteres.':'Enter your email and a password of at least 10 characters.',
  'Esta instalación no permite grabar notas de voz.':'This installation cannot record voice messages.',
  'Esta instalación no permite reproducir la nota de voz.':'This installation cannot play voice messages.',
  'Esta sala todavía no tiene disponible el mosaico de cámaras.':'The camera mosaic is not available in this room yet.',
  'Grabando… toca el botón rojo para enviar. Máximo 30 segundos.':'Recording… tap the red button to send. Maximum 30 seconds.',
  'Guarda tu perfil como Público antes de compartir un Story.':'Save your profile as Public before sharing a Story.',
  'Guardando de forma segura en QSession…':'Saving securely to QSession…','Invitación rechazada.':'Invitation declined.',
  'La cámara permanece apagada. Puedes activarla cuando quieras.':'The camera remains off. You can turn it on whenever you want.',
  'La grabación se canceló al salir de QSession.':'The recording was cancelled when you left QSession.',
  'La nota de voz necesita permiso del micrófono.':'The voice message needs microphone permission.',
  'Micrófono abierto':'Microphone on','Micrófono silenciado':'Microphone muted','No fue posible activar la cámara.':'The camera could not be turned on.',
  'Hablar con la sala y el DJ':'Talk to the room and the DJ','Sólo audio: la cámara no está disponible en el chat general.':'Audio only: camera is not available in the general chat.',
  'Silenciado':'Muted','Mantén para hablar':'Hold to talk','Puedes escribir o participar sólo con audio.':'You can type or participate with audio only.',
  'Micrófono abierto para la sala y el DJ.':'Microphone is on for the room and the DJ.','Micrófono silenciado. Sigues escuchando y escribiendo.':'Microphone muted. You can keep listening and typing.',
  'Silencia el micrófono de la sala antes de grabar una nota de voz.':'Mute the room microphone before recording a voice message.',
  'No fue posible apagar la cámara.':'The camera could not be turned off.','No fue posible iniciar la grabación.':'Recording could not be started.',
  'No fue posible obtener la vista previa de tu cámara.':'Your camera preview could not be opened.',
  'No hay otra persona pública, conectada y disponible para mensajes en esta sala.':'No other public, connected person is available for messages in this room.',
  'No pudimos cambiar el micrófono.':'The microphone could not be changed.',
  'No pudimos comprobar tu ubicación aproximada. Seguirás en la sala sin aparecer en el mapa.':'Your approximate location could not be checked. You will remain in the room without appearing on the map.',
  'Optimizando la foto para QSession…':'Optimizing the photo for QSession…',
  'Para aparecer en el mosaico, configura el perfil como Público y guarda los cambios.':'To appear in the mosaic, set your profile to Public and save the changes.',
  'QSession usará la cámara frontal sólo mientras decidas aparecer en el mosaico de esta sala.':'QSession will use the front camera only while you choose to appear in this room’s mosaic.',
  'Rave global necesita el permiso de ubicación aproximada del teléfono. Puedes seguir escuchando sin activarlo.':'Global rave needs the phone’s approximate location permission. You can keep listening without enabling it.',
  'Recibiste una invitación a una conversación privada.':'You received an invitation to a private conversation.',
  'Silencia el micrófono del chat en vivo antes de grabar una nota de voz.':'Mute the Live Chat microphone before recording a voice message.',
  'Tu cámara en QSession':'Your camera on QSession','Tu perfil está privado o todavía no guardaste el cambio a Público.':'Your profile is private or you have not saved the change to Public yet.',
  'Tu perfil todavía no está sincronizado con QSession. Guárdalo nuevamente antes de publicar.':'Your profile is not synchronized with QSession yet. Save it again before publishing.',
  'Buscando la sala…':'Looking for the room…','Conectado. Preparando el audio…':'Connected. Preparing audio…',
  'Conexión del DJ recuperada. Esperando audio…':'DJ connection restored. Waiting for audio…',
  'El chat en vivo necesita una sala con distribución QSession.':'Live Chat needs a room using QSession delivery.',
  'El chat en vivo terminó.':'Live Chat ended.','El computador no respondió. Revisa el Wi-Fi y deja abierto el servidor QSession.':'The computer did not respond. Check Wi-Fi and keep the QSession server open.',
  'El servidor envió una respuesta inválida.':'The server returned an invalid response.',
  'El video social necesita una sala con distribución QSession.':'Social video needs a room using QSession delivery.',
  'Escribe la dirección del computador.':'Enter the computer address.','La dirección del computador no es válida.':'The computer address is not valid.',
  'La red no responde. Reintentando…':'The network is not responding. Retrying…','La sala sigue abierta mientras recuperamos la señal del DJ…':'The room remains open while the DJ signal is restored…',
  'La señal de audio se interrumpió.':'The audio signal was interrupted.','La señal se interrumpió momentáneamente…':'The signal was briefly interrupted…',
  'La transmisión finalizó.':'The broadcast ended.','No encontramos QSession en esa dirección. Revisa el Wi-Fi y la dirección del computador.':'QSession was not found at that address. Check Wi-Fi and the computer address.',
  'No fue posible completar la conversación privada.':'The private conversation could not be completed.','No se pudo abrir la conexión.':'The connection could not be opened.',
  'Ocurrió un error de conexión.':'A connection error occurred.','QSession está recuperando el audio…':'QSession is restoring audio…',
  'QSession está recuperando la conexión al volver a la aplicación.':'QSession is restoring the connection after returning to the app.',
  'Sala encontrada. Esperando la señal del DJ…':'Room found. Waiting for the DJ signal…','Se perdió la conexión con el computador.':'The connection to the computer was lost.',
  'Comprobando el transporte de la sala…':'Checking the room transport…','Entra a una sala antes de activar tu cámara.':'Join a room before turning on your camera.'
});

const dynamicPatterns: Array<[RegExp, (...parts: string[]) => string]> = [
  [/^(\d+) oyentes? conectados?$/i, (_m,c) => `${c} listener${c === '1' ? '' : 's'} connected`],
  [/^Buscando la sala (.+) en QSession…$/i, (_m,c) => `Looking for room ${c} on QSession…`],
  [/^Muestra: (.+)$/i, (_m,v) => `Preview: ${v}`],
  [/^(\d+) tracks disponibles · toca una muestra para escuchar\.$/i, (_m,c) => `${c} tracks available · tap a preview to listen.`],
  [/^La sala no está activa en Internet\. Buscando (.+) en el Wi-Fi…$/i, (_m,c) => `The room is not active online. Looking for ${c} on Wi-Fi…`],
  [/^La dirección cambió\. Buscando la sala (.+) en el Wi-Fi…$/i, (_m,c) => `The address changed. Looking for room ${c} on Wi-Fi…`],
  [/^(.+) · (Público|Privado) · Guardado en QSession$/i, (_m,n,v) => `${n} · ${v.toLowerCase() === 'público' ? 'Public' : 'Private'} · Saved in QSession`],
  [/^Participas como (.+)$/i, (_m,n) => `Participating as ${n}`],
  [/^(\d+) integrantes$/i, (_m,c) => `${c} members`],
  [/^Crear grupo \((\d+)\)$/i, (_m,c) => `Create group (${c})`],
  [/^Foto (\d+) de (.+)$/i, (_m,n,name) => `Photo ${n} of ${name}`],
  [/^Perfil guardado en QSession y sincronizado con tu cuenta\. Será visible cuando participes en un evento\.$/i, () => 'Profile saved and synchronized with your account. It will be visible when you join an event.'],
  [/^Perfil guardado en QSession y sincronizado con tu cuenta como privado\. Solo tú decides cuándo hacerlo visible\.$/i, () => 'Profile saved privately and synchronized with your account. Only you decide when to make it visible.'],
  [/^SALA (.+)$/i, (_m,c) => `ROOM ${c}`]
];

export function qsessionTranslate(value: string, language: QSessionLanguage): string {
  if (language !== 'en') return value;
  if (english[value]) return english[value];
  for (const [pattern,replacement] of dynamicPatterns) {
    const match = value.match(pattern);
    if (match) return replacement(...match);
  }
  return value;
}

function deviceLanguage(): QSessionLanguage {
  const settings = NativeModules.SettingsManager?.settings;
  const locale = Platform.OS === 'ios'
    ? settings?.AppleLocale || settings?.AppleLanguages?.[0]
    : NativeModules.I18nManager?.localeIdentifier;
  return String(locale || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
}

type LanguageContextValue = {language: QSessionLanguage; setLanguage: (value: QSessionLanguage) => void; toggleLanguage: () => void};
const LanguageContext = createContext<LanguageContextValue>({language: deviceLanguage(),setLanguage:()=>{},toggleLanguage:()=>{}});

export function QSessionLanguageProvider({children}: {children: ReactNode}) {
  const [language,setLanguageState] = useState<QSessionLanguage>(deviceLanguage);
  useEffect(() => {
    void NativeModules.QSessionProfile?.loadLanguage?.().then((stored: string | null) => {
      if (stored === 'es' || stored === 'en') setLanguageState(stored);
    }).catch(() => {});
  },[]);
  const setLanguage = (value: QSessionLanguage) => {
    setLanguageState(value);
    void NativeModules.QSessionProfile?.saveLanguage?.(value).catch(() => {});
  };
  const context = useMemo(() => ({language,setLanguage,toggleLanguage:()=>setLanguage(language === 'es' ? 'en' : 'es')}),[language]);
  return <LanguageContext.Provider value={context}>{children}</LanguageContext.Provider>;
}

export function useQSessionLanguage() { return useContext(LanguageContext); }

function localizedChild(child: ReactNode, language: QSessionLanguage): ReactNode {
  if (typeof child === 'string') return qsessionTranslate(child,language);
  if (Array.isArray(child)) return child.map(item => localizedChild(item,language));
  return child;
}

export function QSessionText({children,...props}: TextProps) {
  const {language} = useQSessionLanguage();
  return <NativeText {...props}>{localizedChild(children,language)}</NativeText>;
}

export function QSessionTextInput(props: TextInputProps) {
  const {language} = useQSessionLanguage();
  return <NativeTextInput {...props} placeholder={props.placeholder ? qsessionTranslate(props.placeholder,language) : undefined}
    accessibilityLabel={props.accessibilityLabel ? qsessionTranslate(props.accessibilityLabel,language) : undefined}/>
}

export function QSessionPressable(props: PressableProps) {
  const {language} = useQSessionLanguage();
  return <NativePressable {...props} accessibilityLabel={typeof props.accessibilityLabel === 'string' ? qsessionTranslate(props.accessibilityLabel,language) : props.accessibilityLabel}/>
}
