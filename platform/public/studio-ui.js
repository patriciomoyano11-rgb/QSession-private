(() => {
  const paths={music:'M9 18V5l12-2v13M9 15c-5-2-7 5-2 5 2 0 2-2 2-5M21 13c-5-2-7 5-2 5 2 0 2-2 2-5',microphone:'M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8',usb:'M12 21V3m-3 3 3-3 3 3M12 16l-5-4V8m5 5 5-4V6',bluetooth:'m7 6 10 12-5 4V2l5 4L7 18',refresh:'M20 8a8 8 0 1 0 1 8M20 3v5h-5',plug:'M8 2v5m8-5v5M6 7h12v4a6 6 0 0 1-12 0ZM12 17v5',hdmi:'M3 5h18v12H3ZM8 21h8m-4-4v4'};
  window.QSessionStudioIcon=name=>`<svg class="studio-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.microphone}"/></svg>`;
  const setup=document.getElementById('hostAudioSetup'),controls=document.getElementById('djControls');
  if(setup&&controls)controls.prepend(setup);
  const invitation=document.getElementById('roomResult'),slot=document.getElementById('musicLibrarySlot');
  if(invitation&&slot)slot.before(invitation);
  document.querySelectorAll('[data-broadcast-source-value]').forEach(b=>{b.firstElementChild.innerHTML=window.QSessionStudioIcon(({library:'music',tab:'music',line:'plug'})[b.dataset.broadcastSourceValue]||b.dataset.broadcastSourceValue)});
  document.querySelectorAll('[data-open-music]').forEach(b=>{b.innerHTML=window.QSessionStudioIcon('music')+'<span>Biblioteca y Auto DJ</span>'});
  ['refreshAudioInputs','refreshVoiceOverlayInputs'].forEach(id=>{const b=document.getElementById(id);if(b)b.innerHTML=window.QSessionStudioIcon('refresh')});
})();
