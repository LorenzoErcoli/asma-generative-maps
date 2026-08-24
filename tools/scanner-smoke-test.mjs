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
await evaluate('calibrateRed(); scan(false); true');
const result=JSON.parse(await evaluate(`JSON.stringify({
  status:document.getElementById('status').textContent,
  candidates:lastCandidateDebug,
  detections:lastDebug.map(item=>({cell:item.cell,color:item.color?.id,cat:item.cat,shape:item.debug?.shape,vertices:item.debug?.vertices,coverage:item.debug?.coverage,top:item.top}))
})`));
result.emptyDetections=emptyDetections;
result.aiMerge=JSON.parse(await evaluate(`(()=>{
  const crops=aiTokenCrops(),autoCrops=aiTokenCrops(.90),crossCrop=crops.find(token=>token.row===3&&token.column===0);
  boardVision[3][0].cat='rosso-quadrato';boardVision[3][0].shapeConfidence=.94;
  boardVision[3][0].debug={...boardVision[3][0].debug,solidity:.74,matchMargin:.01};
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
  const protectedAction=applyAiClassification(protectedColor,{present:true,presence_confidence:.98,color:'turchese',shape:'quadrato',color_confidence:.96,shape_confidence:.97},{crop:true});
  const recovered=emptyVision()[0][0];recovered.possiblePawn=true;recovered.presenceConfidence=.48;recovered.debug={center:{x:0,y:0}};
  const recoverAction=applyAiClassification(recovered,{present:true,presence_confidence:.94,color:'verde',shape:'cerchio',color_confidence:.95,shape_confidence:.96},{crop:true,allowAdd:true});
  return JSON.stringify({
    summary,cropCount:crops.length,autoCropCount:autoCrops.length,cross:boardVision[3][0].cat,falsePositive:boardVision[7][7].pawn,
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
  result.aiMerge.protectedColor.disagreement?.ai!=='turchese'||!result.aiMerge.protectedColor.review.includes('colore')||result.aiMerge.calibration.context.length!==1||!result.aiMerge.calibration.cropCalibrated||
  !result.aiMerge.recovery.pawn||result.aiMerge.recovery.cat!=='verde-cerchio'){
  throw new Error(`Scanner smoke test failed: ${JSON.stringify(result.aiMerge)}`);
}

await call('Page.navigate',{url:`${baseUrl}/ipad-board.html?matrix-smoke=1`});
await wait(1000);
const matrixLayout=JSON.parse(await evaluate('shapeTest(); JSON.stringify(grid)'));
const matrixCapture=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});

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
if(matrixCells.length!==40||matrixLayout[0][0]?.cat!=='rosso-quadrato'||matrixLayout[4][7]?.cat!=='magenta-pentagono'||
  !matrix.calibrated||matrix.samples.length!==8||matrix.samples.some(color=>color.samples!==5)||
  matrix.result.presence!==40||matrix.result.colorCorrect!==40||matrix.result.exact!==40||matrix.result.falsePositives!==0){
  throw new Error(`Matrix smoke test failed: ${JSON.stringify(matrix)}`);
}
console.log(JSON.stringify(result,null,2));
ws.close();
