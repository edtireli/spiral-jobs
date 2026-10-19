chrome.action.onClicked.addListener(async()=>{
 const url=chrome.runtime.getURL('connector.html');
 const tabs=await chrome.tabs.query({});const existing=tabs.find(t=>t.url===url);
 if(existing)await chrome.tabs.update(existing.id,{active:true});else await chrome.tabs.create({url});
});
