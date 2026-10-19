import test from 'node:test';
import assert from 'node:assert/strict';
import {validVisionAction} from '../lib/navigator.mjs';
const observation={controls:[{target:'0:4',label:'Cover letter',type:'file',isField:true,pending:true},{target:'0:5',label:'Submit application',type:'submit',isField:false},{target:'0:6',label:'Next',type:'button',isField:false}]};
test('vision must select an observed control of the correct kind before acting',()=>{
 const action={action:'final',reason:'Form complete.'};
 for(const target of [undefined,'Submit application','q123','0:999','0:4'])assert.equal(validVisionAction({...action,target},observation,'fill'),false);
 assert.equal(validVisionAction({...action,target:'0:5'},observation,'fill'),true);
 assert.equal(validVisionAction({...action,target:'0:5'},observation,'inspect'),false);
 assert.equal(validVisionAction({action:'click',target:'0:5',reason:'Submit'},observation,'fill'),false);
 assert.equal(validVisionAction({action:'click',target:'0:6',reason:'Continue'},observation,'fill'),true);
 assert.equal(validVisionAction({action:'fill',target:'0:5',reason:'Fill'},observation,'fill'),false);
 assert.equal(validVisionAction({action:'fill',target:'0:4',reason:'Attach'},observation,'fill'),true);
});
test('vision cannot refill an already completed zero-years answer',()=>{
 const completed={controls:[{target:'0:4',label:'Years of consulting experience',type:'text',isField:true,filled:true,pending:false,invalid:false}]};
 assert.equal(validVisionAction({action:'fill',target:'0:4',reason:'Zero is invalid'},completed,'fill'),false);
});
test('LinkedIn import cannot become a navigation or submit action',()=>{
 for(const control of [{label:'Apply with LinkedIn',type:'submit'},{label:'Continue',href:'https://www.linkedin.com/oauth/v2/authorization'}]){
  const o={controls:[{...control,target:'0:1',isField:false}]};
  for(const action of ['click','final'])for(const phase of ['inspect','fill'])assert.equal(validVisionAction({action,target:'0:1',reason:'Use LinkedIn'},o,phase),false);
 }
 const o={controls:[{target:'0:2',label:'LinkedIn Profile',isField:true,required:false,pending:true}]};
 assert.equal(validVisionAction({action:'fill',target:'0:2',reason:'Add profile'},o,'fill'),false);
});
