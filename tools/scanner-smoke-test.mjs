const port=Number(process.argv[2]||9227);
const baseUrl=(process.argv[3]||'http://127.0.0.1:8765').replace(/\/$/,'');
const tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const tab=tabs.find(item=>item.type==='page');
if(!tab)throw new Error('No browser page found');

const ws=new WebSocket(tab.webSocketDebuggerUrl);
let id=0;
const pending=new Map();
ws.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(message.id&&pending.has(message.id)){
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};
await new Promise(resolve=>ws.onopen=resolve);
const call=(method,params={})=>new Promise(resolve=>{
  const requestId=++id;
  pending.set(requestId,resolve);
  ws.send(JSON.stringify({id:requestId,method,params}));
});
const evaluate=async(expression,awaitPromise=false)=>{
  const reply=await call('Runtime.evaluate',{expression,awaitPromise,returnByValue:true});
  if(reply.result?.exceptionDetails)throw new Error(reply.result.exceptionDetails.text);
  return reply.result?.result?.value;
};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

await call('Emulation.setDeviceMetricsOverride',{width:1400,height:1000,deviceScaleFactor:1,mobile:false});
await call('Page.navigate',{url:`${baseUrl}/ipad-board.html?shape-smoke=1`});
await wait(1500);
await evaluate('document.getElementById("clear").click(); true');
const rect=JSON.parse(await evaluate('JSON.stringify(document.getElementById("board").getBoundingClientRect())'));
const corners=[
  {x:rect.left,y:rect.top},
  {x:rect.right,y:rect.top},
  {x:rect.right,y:rect.bottom},
  {x:rect.left,y:rect.bottom}
];
const emptyCapture=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});

await call('Page.navigate',{url:`${baseUrl}/scanner.html?board-smoke=1`});
await wait(7000);
const mirrorSmoke=JSON.parse(await evaluate(`JSON.stringify((()=>{
  const source=document.createElement('canvas'),target=document.createElement('canvas');source.width=target.width=2;source.height=target.height=1;
  const sourceCtx=source.getContext('2d'),targetCtx=target.getContext('2d');
  sourceCtx.fillStyle='#ff0000';sourceCtx.fillRect(0,0,1,1);sourceCtx.fillStyle='#0000ff';sourceCtx.fillRect(1,0,1,1);
  drawCameraFrame(targetCtx,source,0,0,2,1,true);
  const mirrored=[...targetCtx.getImageData(0,0,2,1).data];targetCtx.clearRect(0,0,2,1);
  drawCameraFrame(targetCtx,source,0,0,2,1,false);
  return {mirrored,plain:[...targetCtx.getImageData(0,0,2,1).data]};
})())`));
if(mirrorSmoke.mirrored[2]!==255||mirrorSmoke.mirrored[4]!==255||mirrorSmoke.plain[0]!==255||mirrorSmoke.plain[6]!==255){
  throw new Error(`Camera mirror failed: ${JSON.stringify(mirrorSmoke)}`);
}
await evaluate(`loadSnapshotPayload(${JSON.stringify({image:`data:image/png;base64,${emptyCapture.result.data}`,corners})})`,true);
await wait(500);
const emptyDetections=await evaluate('calibrateBoard(); scan(false); boardVision.flat().filter(cell=>cell.pawn).length');
const learnedBoard=JSON.parse(await evaluate('JSON.stringify(boardCalibration)'));

await call('Page.navigate',{url:`${baseUrl}/ipad-board.html?shape-smoke=2`});
await wait(1000);
await evaluate(`redTest();
  document.querySelectorAll('#board .tile').forEach((tile,index)=>{
    const shifts=[[-8,-5],[7,-7],[-6,8],[8,6],[-7,4]][index];
    tile.style.transform='translate('+shifts[0]+'px,'+shifts[1]+'px) rotate('+(index*31+17)+'deg)';
  }); true`);
const capture=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});

await call('Page.navigate',{url:`${baseUrl}/scanner.html?shape-smoke=1`});
await wait(7000);
const payload={image:`data:image/png;base64,${capture.result.data}`,corners,boardCalibration:learnedBoard};
await evaluate(`loadSnapshotPayload(${JSON.stringify(payload)})`,true);
await wait(1000);
const redCalibration=JSON.parse(await evaluate(`(()=>{
  const capture=captureSupervisedCalibration(redCalibrationTargets());
  const ok=calibrateRed(),calibrationStatus=document.getElementById('status').textContent;
  scan(false);
  return JSON.stringify({ok,calibrationStatus,orientation:capture.orientation,colors:colorCalibration?.colors,sampleCells:[...capture.samples.keys()],targetSamples:capture.targets.map(target=>({r:target.r,c:target.c,hasSample:!!target.sample}))});
})()`));
const result=JSON.parse(await evaluate(`JSON.stringify({
  status:document.getElementById('status').textContent,
  candidates:lastCandidateDebug,
  detections:lastDebug.map(item=>({cell:item.cell,color:item.color?.id,cat:item.cat,shape:item.debug?.shape,vertices:item.debug?.vertices,coverage:item.debug?.coverage,top:item.top}))
})`));
result.redCalibration=redCalibration;
result.emptyDetections=emptyDetections;
if(result.detections.length!==5){
  throw new Error(`Red calibration failed before AI merge: ${JSON.stringify(result)}`);
}
result.autoAiFallback=JSON.parse(await evaluate(`(async()=>{
  const original=requestAiVision,expected=aiTokenCrops().length;
  let requested=0;
  requestAiVision=async(mode,image,tokens)=>{requested=tokens.length;throw new Error('offline smoke')};
  document.getElementById('autoAi').checked=true;
  const ok=await scanWithAutomaticAi();
  requestAiVision=original;
  return JSON.stringify({ok,expected,requested,status:document.getElementById('status').textContent});
})()`,true));
if(!result.autoAiFallback.ok||result.autoAiFallback.expected<5||result.autoAiFallback.requested!==result.autoAiFallback.expected||!result.autoAiFallback.status.toLowerCase().includes('lettura locale')){
  throw new Error(`Automatic AI fallback failed: ${JSON.stringify(result.autoAiFallback)}`);
}
result.aiMerge=JSON.parse(await evaluate(`(()=>{
  const crops=aiTokenCrops(),autoCrops=aiTokenCrops(.90),crossCrop=crops.find(token=>token.row===5&&token.column===0);
  boardVision[5][0].cat='rosso-quadrato';boardVision[5][0].shapeConfidence=.94;
  boardVision[5][0].debug={...boardVision[5][0].debug,solidity:.74,matchMargin:.01};
  const summary=mergeAiBoard({
    cells:[{row:7,column:7,color:'rosso',shape:'cerchio',presence_confidence:.55,color_confidence:.9,shape_confidence:.9}],
    tokens:[{slot:crossCrop.slot,present:true,presence_confidence:.98,color:'rosso',shape:'croce',color_confidence:.99,shape_confidence:.96}]
  },crops);
  const rejected=structuredClone(boardVision[0][0]);
  const rejectAction=applyAiClassification(rejected,{present:false,presence_confidence:.97,color:'sconosciuto',shape:'sconosciuta',color_confidence:0,shape_confidence:0},{crop:true});
  const ambiguous=structuredClone(boardVision[0][0]);
  const ambiguousAction=applyAiClassification(ambiguous,{present:false,presence_confidence:.55,color:'sconosciuto',shape:'sconosciuta',color_confidence:0,shape_confidence:0},{crop:true});
  const recolored=structuredClone(boardVision[0][0]);recolored.colorConfidence=.55;recolored.color.confident=false;recolored.color.calibrated=false;
  const colorAction=applyAiClassification(recolored,{present:true,presence_confidence:.98,color:'blu',shape:'quadrato',color_confidence:.96,shape_confidence:.97},{crop:true});
  const protectedColor=structuredClone(boardVision[0][0]);protectedColor.colorConfidence=.55;protectedColor.color.confident=false;protectedColor.color.calibrated=true;
  const protectedAction=applyAiClassification(protectedColor,{present:true,presence_confidence:.98,color:'grigio',shape:'quadrato',color_confidence:.96,shape_confidence:.97},{crop:true});
  const recovered=emptyVision()[0][0];recovered.possiblePawn=true;recovered.presenceConfidence=.48;recovered.debug={center:{x:0,y:0}};
  const recoverAction=applyAiClassification(recovered,{present:true,presence_confidence:.94,color:'verde',shape:'cerchio',color_confidence:.95,shape_confidence:.96},{crop:true,allowAdd:true});
  return JSON.stringify({
    summary,cropCount:crops.length,autoCropCount:autoCrops.length,cross:boardVision[5][0].cat,falsePositive:boardVision[7][7].pawn,
    rejection:{action:rejectAction,pawn:rejected.pawn},
    ambiguous:{action:ambiguousAction,pawn:ambiguous.pawn,review:derivedReviewReasons(ambiguous)},
    recolor:{action:colorAction,cat:recolored.cat,color:recolored.color?.id},
    protectedColor:{action:protectedAction,cat:protectedColor.cat,color:protectedColor.color?.id,disagreement:protectedColor.colorDisagreement,review:derivedReviewReasons(protectedColor)},
    calibration:{context:aiCalibrationContext(),cropCalibrated:crops.every(crop=>crop.localColorCalibrated)},
    recovery:{action:recoverAction,pawn:recovered.pawn,cat:recovered.cat}
  });
})()`));
if(result.emptyDetections!==0||result.detections.length!==5||result.aiMerge.cropCount!==5||result.aiMerge.autoCropCount<1||result.aiMerge.autoCropCount>=5||result.aiMerge.cross!=='rosso-croce'||result.aiMerge.falsePositive||
  result.aiMerge.rejection.action!=='removed'||result.aiMerge.rejection.pawn||result.aiMerge.ambiguous.action!=='uncertain'||!result.aiMerge.ambiguous.pawn||!result.aiMerge.ambiguous.review.includes('presenza')||
  result.aiMerge.recolor.color!=='blu'||result.aiMerge.recolor.cat!=='blu-quadrato'||result.aiMerge.protectedColor.color!=='rosso'||result.aiMerge.protectedColor.cat!=='rosso-quadrato'||
  result.aiMerge.protectedColor.disagreement?.ai!=='grigio'||!result.aiMerge.protectedColor.review.includes('colore')||result.aiMerge.calibration.context.length!==1||!result.aiMerge.calibration.cropCalibrated||
  !result.aiMerge.recovery.pawn||result.aiMerge.recovery.cat!=='verde-cerchio'){
  throw new Error(`Scanner smoke test failed: ${JSON.stringify({emptyDetections:result.emptyDetections,detections:result.detections.length,aiMerge:result.aiMerge})}`);
}

await call('Page.navigate',{url:`${baseUrl}/ipad-board.html?matrix-smoke=1`});
await wait(1000);
const matrixLayout=JSON.parse(await evaluate('shapeTest(); JSON.stringify(grid)'));
const matrixCapture=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
await evaluate(`for(const row of CALIBRATION_ROWS)grid[row][6]=null;render();true`);
const missingVioletCapture=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});

await call('Page.navigate',{url:`${baseUrl}/scanner.html?matrix-smoke=1`});
await wait(7000);
await evaluate(`loadSnapshotPayload(${JSON.stringify({image:`data:image/png;base64,${matrixCapture.result.data}`,corners,boardCalibration:learnedBoard})})`,true);
await wait(1000);
const matrix=JSON.parse(await evaluate(`(()=>{
  const calibrated=calibrateColors();
  scan(false);
  return JSON.stringify({
    calibrated,
    samples:colorCalibration?.colors?.map(color=>({id:color.id,samples:color.samples}))||[],
    result:evaluateMatrixResult()
  });
})()`));
result.matrix=matrix;
const matrixCells=matrixLayout.flat().filter(Boolean);
if(matrixCells.length!==40||matrixLayout[0][0]?.cat!=='rosso-quadrato'||matrixLayout[7][7]?.cat!=='magenta-pentagono'||
  !matrix.calibrated||matrix.samples.length!==8||matrix.samples.some(color=>color.samples!==5)||
  matrix.result.presence!==40||matrix.result.colorCorrect!==40||matrix.result.exact!==40||matrix.result.falsePositives!==0){
  throw new Error(`Matrix smoke test failed: ${JSON.stringify(matrix)}`);
}
const completeCalibration=JSON.parse(await evaluate('JSON.stringify(colorCalibration)'));
await evaluate(`loadSnapshotPayload(${JSON.stringify({image:`data:image/png;base64,${missingVioletCapture.result.data}`,corners,boardCalibration:learnedBoard})})`,true);
await wait(500);
const incompleteCalibration=JSON.parse(await evaluate(`(()=>{
  const calibrated=calibrateColors();
  return JSON.stringify({calibrated,status:document.getElementById('status').textContent,colors:colorCalibration?.colors?.map(color=>color.id)||[]});
})()`));
result.incompleteCalibration=incompleteCalibration;
if(incompleteCalibration.calibrated||!incompleteCalibration.status.includes('Calibrazione annullata')||JSON.stringify(incompleteCalibration.colors)!==JSON.stringify(completeCalibration.colors.map(color=>color.id))){
  throw new Error(`Incomplete calibration guard failed: ${JSON.stringify(incompleteCalibration)}`);
}

await call('Page.navigate',{url:`${baseUrl}/ipad-board.html?printed-color-smoke=1`});
await wait(1000);
await evaluate(`shapeTest();(()=>{
  const printed=['#d66f70','#e29a76','#cfb268','#0788a2','#7f9098','#2859ad','#9f65ae','#d85f84'];
  document.querySelectorAll('#board .cell').forEach((cell,index)=>{
    const tile=cell.querySelector('.tile');if(!tile)return;
    const row=Math.floor(index/8),column=index%8;
    tile.style.background=printed[column];
    tile.style.transform='translate('+(((row*7+column*3)%7)-3)+'px,'+(((row*3+column*5)%7)-3)+'px) rotate('+((row*19+column*13)%41-20)+'deg)';
  });
  document.getElementById('board').style.filter='brightness(.88) saturate(.78)';
})();true`);
const printedCapture=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
await call('Page.navigate',{url:`${baseUrl}/scanner.html?printed-color-smoke=1`});
await wait(7000);
await evaluate(`loadSnapshotPayload(${JSON.stringify({image:`data:image/png;base64,${printedCapture.result.data}`,corners,boardCalibration:learnedBoard})})`,true);
await wait(700);
const printedMatrix=JSON.parse(await evaluate(`(()=>{
  const calibrated=calibrateColors();scan(false);
  return JSON.stringify({calibrated,samples:colorCalibration?.colors?.map(color=>({id:color.id,samples:color.samples}))||[],result:evaluateMatrixResult()});
})()`));
result.printedMatrix=printedMatrix;
if(!printedMatrix.calibrated||printedMatrix.samples.length!==8||printedMatrix.samples.some(color=>color.samples!==5)||printedMatrix.result.presence!==40||printedMatrix.result.colorCorrect!==40){
  throw new Error(`Printed color calibration failed: ${JSON.stringify(printedMatrix)}`);
}

await call('Page.navigate',{url:`${baseUrl}/ipad-board.html?rotated-calibration-smoke=1`});
await wait(1000);
await evaluate(`redTest();document.getElementById('board').style.transform='rotate(180deg)';true`);
const rotatedCapture=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
await call('Page.navigate',{url:`${baseUrl}/scanner.html?rotated-calibration-smoke=1`});
await wait(7000);
await evaluate(`loadSnapshotPayload(${JSON.stringify({image:`data:image/png;base64,${rotatedCapture.result.data}`,corners,boardCalibration:learnedBoard})})`,true);
await wait(1000);
const rotatedCalibration=JSON.parse(await evaluate(`(()=>{
  const calibrated=calibrateRed();scan(false);
  return JSON.stringify({calibrated,orientation:colorCalibration?.orientation,colors:[...new Set(boardVision.flat().filter(cell=>cell.pawn).map(cell=>cell.color?.id))],detections:boardVision.flat().filter(cell=>cell.pawn).length});
})()`));
result.rotatedCalibration=rotatedCalibration;
if(!rotatedCalibration.calibrated||rotatedCalibration.orientation!==2||rotatedCalibration.detections!==5||rotatedCalibration.colors.length!==1||rotatedCalibration.colors[0]!=='rosso'){
  throw new Error(`Rotated calibration smoke test failed: ${JSON.stringify(rotatedCalibration)}`);
}

await call('Page.navigate',{url:`${baseUrl}/scanner.html?dashboard=1&dashboard-calibration-smoke=1`});
await wait(7000);
await evaluate(`loadSnapshotPayload(${JSON.stringify({image:`data:image/png;base64,${matrixCapture.result.data}`,corners,boardCalibration:learnedBoard,colorCalibration:completeCalibration})})`,true);
await wait(800);
result.dashboardCalibration=JSON.parse(await evaluate(`(async()=>{
  calibrationDialog.showModal();drawDashboardCrop();await new Promise(resolve=>setTimeout(resolve,150));
  const pixels=calibrationCrop.getContext('2d').getImageData(0,0,calibrationCrop.width,calibrationCrop.height).data;
  let visible=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]+pixels[i+1]+pixels[i+2]>45)visible++;
  let aiCalls=0;
  const normalized=corners.map(point=>({x:point.x*1000/rawCanvas.width,y:point.y*1000/rawCanvas.height}));
  requestAiVision=async mode=>{aiCalls++;if(mode!=='corners')throw new Error('wrong mode');return {top_left:normalized[0],top_right:normalized[1],bottom_right:normalized[2],bottom_left:normalized[3],confidence:.93}};
  const tracked=await proposeAiCorners({fallbackToLocal:true});
  return JSON.stringify({visibleRatio:visible/(pixels.length/4),aiCalls,tracked,corners:corners.length});
})()`,true));
if(result.dashboardCalibration.visibleRatio<.5||result.dashboardCalibration.aiCalls!==1||!result.dashboardCalibration.tracked||result.dashboardCalibration.corners!==4){
  throw new Error(`Dashboard calibration preview failed: ${JSON.stringify(result.dashboardCalibration)}`);
}

await evaluate(`localStorage.setItem('asma.colorCalibration.v8',${JSON.stringify(JSON.stringify(completeCalibration))});true`);
await call('Page.navigate',{url:`${baseUrl}/index.html?scanner-integration-smoke=1`});
await wait(3500);
const integration=JSON.parse(await evaluate(`(()=>{
  const incoming=Array.from({length:8},()=>Array(8).fill(null));
  incoming[0][0]={kind:'place',cat:'grigio-croce',ord:1};
  incoming[0][1]={kind:'place',cat:'chiesa',ord:2};
  const applied=applyExternalGrid({source:'camera-scanner',time:Date.now()+1000,grid:incoming});
  const scannerFrame=document.getElementById('scannerFrame');
  const frameInDock=scannerFrame.parentElement?.id==='cameraDock';
  const savedCalibration=JSON.parse(localStorage.getItem('asma.colorCalibration.v8')||'null');
  scannerFrame.contentWindow.__asmaIntegrationIdentity='same-frame';
  document.getElementById('btnCamera').click();
  return JSON.stringify({applied,frameInDock,savedColors:savedCalibration?.colors?.length||0});
})()`));
await wait(300);
integration.calibration=JSON.parse(await evaluate(`JSON.stringify((()=>{
  const scannerFrame=document.getElementById('scannerFrame');
  const doc=scannerFrame.contentDocument;
  return {expanded:document.body.classList.contains('scanner-calibration-open'),frameInDock:scannerFrame.parentElement?.id==='cameraDock',sameFrame:scannerFrame.contentWindow.__asmaIntegrationIdentity==='same-frame',dialogOpen:doc.getElementById('calibrationDialog').open,cropPresent:!!doc.getElementById('calibrationCrop')};
})())`));
await evaluate(`document.getElementById('scannerFrame').contentDocument.getElementById('closeCalibration').click();true`);
await wait(200);
integration.calibration.closed=JSON.parse(await evaluate(`JSON.stringify({collapsed:!document.body.classList.contains('scanner-calibration-open'),frameInDock:document.getElementById('scannerFrame').parentElement?.id==='cameraDock'})`));
integration.render=JSON.parse(await evaluate(`generate();JSON.stringify({marker:grid[0][0],place:grid[0][1],markerShape:document.querySelector('#grid .marker-shape.croce')!==null,mapRendered:document.querySelector('#mapHost svg')!==null})`));
await call('Page.reload');
await wait(3500);
integration.reload=JSON.parse(await evaluate(`JSON.stringify((()=>{
  const scannerFrame=document.getElementById('scannerFrame');
  const savedCalibration=JSON.parse(localStorage.getItem('asma.colorCalibration.v8')||'null');
  return {frameInDock:scannerFrame.parentElement?.id==='cameraDock',dashboardMode:scannerFrame.contentDocument?.body.classList.contains('dashboard')||false,savedColors:savedCalibration?.colors?.length||0};
})())`));
result.integration=integration;
if(!integration.applied||!integration.frameInDock||integration.savedColors!==8||!integration.calibration.expanded||!integration.calibration.frameInDock||!integration.calibration.sameFrame||!integration.calibration.dialogOpen||!integration.calibration.cropPresent||
  !integration.calibration.closed.collapsed||!integration.calibration.closed.frameInDock||integration.render.marker?.kind!=='marker'||integration.render.marker?.marker!=='grigio-croce'||integration.render.place?.cat!=='chiesa'||!integration.render.markerShape||!integration.render.mapRendered||
  !integration.reload.frameInDock||!integration.reload.dashboardMode||integration.reload.savedColors!==8){
  throw new Error(`Scanner integration smoke test failed: ${JSON.stringify(integration)}`);
}
console.log(JSON.stringify(result,null,2));
ws.close();
