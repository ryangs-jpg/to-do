'use strict';
(() => {
  const $=s=>document.querySelector(s), garden=globalThis.OneStepGarden;
  let previewTimer=0, celebrationTimer=0;
  function render(saved){const s=garden.status(saved),card=$('#garden-card');if(card.dataset.stage!==String(s.index)){$('#garden-scene').innerHTML=garden.scene(s.index);card.dataset.stage=s.index}$('#garden-stage').textContent=s.name;$('#garden-message').textContent=s.message;$('#garden-steps').textContent=`지금까지 ${s.count}걸음`;$('#garden-next').textContent=s.next?`${s.next.name}까지 ${s.next.at-s.count}걸음`:'귤이 열렸어요. 다음 걸음도 함께해요.';$('#garden-fill').style.width=`${Math.round(s.progress*100)}%`;$('#garden-meter').setAttribute('aria-valuenow',Math.round(s.progress*100));$('#garden-meter').setAttribute('aria-valuetext',s.next?`${s.name}, 다음 단계까지 ${s.next.at-s.count}걸음`:'귤이 열린 나무');$('#garden-stage-list').innerHTML=garden.stages.map((stage,i)=>`<span class="${i<=s.index?'reached':''}" ${i===s.index?'aria-current="step"':''}>${stage.name.replace('작은 ','').replace('초록 ','').replace('튼튼한 ','').replace('하얀 ','').replace('달콤한 ','')}</span>`).join('');}
  function celebrate(){const card=$('#garden-card');clearTimeout(celebrationTimer);card.classList.remove('is-growing');void card.offsetWidth;card.classList.add('is-growing');$('#garden-live').textContent='한 걸음이 정원에 쌓였어요.';celebrationTimer=setTimeout(()=>card.classList.remove('is-growing'),1600);}
  const dialog=$('#garden-dialog');
  function stop(){clearTimeout(previewTimer);previewTimer=0;}
  function preview(){stop();let index=0;function advance(){$('#garden-preview-scene').innerHTML=garden.scene(index);$('#garden-preview-scene').classList.remove('is-growing');void $('#garden-preview-scene').offsetWidth;$('#garden-preview-scene').classList.add('is-growing');$('#garden-preview-stage').textContent=garden.stages[index].name;$('#garden-preview-message').textContent=garden.stages[index].message;if(index<4){index++;previewTimer=setTimeout(advance,1250)}else stop()}advance();}
  $('#garden-preview-btn').addEventListener('click',()=>{dialog.showModal();preview();});
  $('#garden-replay').addEventListener('click',preview);
  dialog.addEventListener('close',stop);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
  globalThis.OneStepGardenUI={render,celebrate};
})();
