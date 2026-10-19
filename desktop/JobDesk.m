#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface JobDesk : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate>
@property NSWindow *window;
@property WKWebView *web;
@property NSTask *launcher;
@property NSPipe *pipe;
@property NSMutableData *buffer;
@property NSURL *baseURL;
@property BOOL quitting;
@property BOOL noModels;
@end

@implementation JobDesk
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
 self.noModels = [NSProcessInfo.processInfo.arguments containsObject:@"--no-models"];
 NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
 [self setupMenu];
 WKWebViewConfiguration *config = [WKWebViewConfiguration new];config.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
 self.web = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:config];self.web.navigationDelegate=self;self.web.UIDelegate=self;
 [self.web setValue:@NO forKey:@"drawsBackground"];
 NSRect screen = NSScreen.mainScreen.visibleFrame;
 self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,MIN(1450,screen.size.width*.93),MIN(1000,screen.size.height*.9)) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
 self.window.title=@"Spiral Jobs";self.window.titlebarAppearsTransparent=YES;self.window.backgroundColor=NSColor.blackColor;self.window.minSize=NSMakeSize(880,600);self.window.contentView=self.web;
 [self.window center];[self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];[self connect];
}
- (void)setupMenu {
 NSMenu *menu=[NSMenu new],*appMenu=[NSMenu new];NSMenuItem *appItem=[NSMenuItem new];
 NSArray *items=@[@[@"About Spiral Jobs",@"about",@""],@[@"Reconnect",@"reconnect",@"r"],@[@"Open in Browser",@"openBrowser",@"b"],@[@"Show Workspace",@"showWorkspace",@""]];
 for(NSArray *v in items){NSMenuItem *item=[appMenu addItemWithTitle:v[0] action:NSSelectorFromString(v[1]) keyEquivalent:v[2]];item.target=self;}
 [appMenu addItem:NSMenuItem.separatorItem];[appMenu addItemWithTitle:@"Quit Spiral Jobs" action:@selector(terminate:) keyEquivalent:@"q"];appItem.submenu=appMenu;[menu addItem:appItem];
 NSMenuItem *editItem=[NSMenuItem new];NSMenu *edit=[[NSMenu alloc] initWithTitle:@"Edit"];
 for(NSArray *v in @[@[@"Undo",@"undo:",@"z"],@[@"Cut",@"cut:",@"x"],@[@"Copy",@"copy:",@"c"],@[@"Paste",@"paste:",@"v"],@[@"Select All",@"selectAll:",@"a"]]) [edit addItemWithTitle:v[0] action:NSSelectorFromString(v[1]) keyEquivalent:v[2]];
 editItem.submenu=edit;[menu addItem:editItem];NSApp.mainMenu=menu;
}
- (void)splash:(NSString *)message error:(BOOL)error {
 NSString *escaped=[[[message stringByReplacingOccurrencesOfString:@"&" withString:@"&amp;"] stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"] stringByReplacingOccurrencesOfString:@">" withString:@"&gt;"];
 NSString *html=[NSString stringWithFormat:@"<html><meta name='color-scheme' content='dark'><body style='background:#000;color:#eee;margin:0;height:100vh;display:grid;place-content:center;text-align:center;font-family:-apple-system'><h1 style='font-weight:300;font-size:46px;letter-spacing:-2px'>spiral jobs</h1><p style='color:#888;font:11px Menlo'>%@</p>%@</body></html>",escaped,error?@"<p style='color:#666;font:10px Menlo'>Spiral Jobs → Reconnect to retry</p>":@""];
 [self.web loadHTMLString:html baseURL:nil];
}
- (void)connect {
 [self splash:@"opening…" error:NO];self.baseURL=nil;self.buffer=[NSMutableData new];
 NSURL *resources=NSBundle.mainBundle.resourceURL;NSTask *process=[NSTask new];NSPipe *output=[NSPipe pipe];self.pipe=output;
 process.executableURL=[resources URLByAppendingPathComponent:@"bin/node"];
 NSMutableArray *args=[NSMutableArray arrayWithObject:[[resources URLByAppendingPathComponent:@"app/desktop/launch.mjs"] path]];if(self.noModels)[args addObject:@"--no-models"];process.arguments=args;
 process.standardOutput=output;process.standardError=NSFileHandle.fileHandleWithNullDevice;
 NSMutableDictionary *env=[NSProcessInfo.processInfo.environment mutableCopy];env[@"PATH"]=@"/usr/local/bin:/opt/homebrew/bin:/Library/TeX/texbin:/usr/bin:/bin:/usr/sbin:/sbin";env[@"PLAYWRIGHT_BROWSERS_PATH"]=[[resources URLByAppendingPathComponent:@"browsers"] path];env[@"SPIRAL_JOBS_TECTONIC"]=[[resources URLByAppendingPathComponent:@"bin/tectonic"] path];process.environment=env;
 __weak JobDesk *weakSelf=self;output.fileHandleForReading.readabilityHandler=^(NSFileHandle *handle){NSData *data=handle.availableData;if(!data.length){handle.readabilityHandler=nil;return;}dispatch_async(dispatch_get_main_queue(), ^{[weakSelf consume:data];});};
 self.launcher=process;NSError *error=nil;if(![process launchAndReturnError:&error])[self splash:error.localizedDescription error:YES];
}
- (void)consume:(NSData *)data {
 [self.buffer appendData:data];NSData *newline=[@"\n" dataUsingEncoding:NSUTF8StringEncoding];
 while(YES){NSRange range=[self.buffer rangeOfData:newline options:0 range:NSMakeRange(0,self.buffer.length)];if(range.location==NSNotFound)break;
 NSData *line=[self.buffer subdataWithRange:NSMakeRange(0,range.location)];[self.buffer replaceBytesInRange:NSMakeRange(0,range.location+1) withBytes:NULL length:0];
 NSDictionary *event=[NSJSONSerialization JSONObjectWithData:line options:0 error:nil];if(![event isKindOfClass:NSDictionary.class])continue;NSString *type=event[@"event"];
 if([type isEqual:@"ready"]){NSURL *url=[NSURL URLWithString:event[@"url"]];if([url.host isEqual:@"127.0.0.1"]){self.baseURL=url;[self.web loadRequest:[NSURLRequest requestWithURL:url]];}}
 else if([type isEqual:@"status"]&&!self.baseURL)[self splash:event[@"message"]?:@"opening…" error:NO];
 else if([type isEqual:@"error"])[self splash:event[@"message"]?:@"Could not start." error:YES];
 }
}
- (void)reconnect { if(self.launcher.isRunning){__weak JobDesk *weakSelf=self;self.launcher.terminationHandler=^(NSTask *task){dispatch_async(dispatch_get_main_queue(), ^{[weakSelf connect];});};[self.launcher terminate];}else [self connect]; }
- (void)openBrowser { if(self.baseURL)[NSWorkspace.sharedWorkspace openURL:self.baseURL]; }
- (void)showWorkspace { NSURL *file=[NSBundle.mainBundle.resourceURL URLByAppendingPathComponent:@"app/desktop/config.json"];NSData *data=[NSData dataWithContentsOfURL:file];NSDictionary *config=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:nil]:nil;NSString *directory=config[@"dataDir"]?:[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/Spiral Jobs/data"];[NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:directory]]; }
- (void)about {[NSApp orderFrontStandardAboutPanelWithOptions:@{NSAboutPanelOptionApplicationName:@"Spiral Jobs",NSAboutPanelOptionApplicationVersion:[NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"],NSAboutPanelOptionCredits:[[NSAttributedString alloc] initWithString:@"Local job search · Denmark\nLocal models. Visible actions. Optional Auto apply."]}];}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {[self.window makeKeyAndOrderFront:nil];return YES;}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {return YES;}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
 if(self.quitting)return NSTerminateNow;self.quitting=YES;if(!self.launcher.isRunning)return NSTerminateNow;
 self.launcher.terminationHandler=^(NSTask *task){dispatch_async(dispatch_get_main_queue(), ^{[NSApp replyToApplicationShouldTerminate:YES];});};[self.launcher terminate];
 dispatch_after(dispatch_time(DISPATCH_TIME_NOW,6*NSEC_PER_SEC),dispatch_get_main_queue(), ^{[NSApp replyToApplicationShouldTerminate:YES];});return NSTerminateLater;
}
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
 NSURL *url=action.request.URL;if(!url){handler(WKNavigationActionPolicyCancel);return;}if([url.scheme isEqual:@"about"]){handler(WKNavigationActionPolicyAllow);return;}
 if([url.scheme isEqual:@"http"]&&[url.host isEqual:@"127.0.0.1"]&&[url.port isEqual:self.baseURL.port]){
  if(action.shouldPerformDownload)handler(WKNavigationActionPolicyDownload);
  else if(!action.targetFrame&&action.navigationType==WKNavigationTypeLinkActivated){[NSWorkspace.sharedWorkspace openURL:url];handler(WKNavigationActionPolicyCancel);}else handler(WKNavigationActionPolicyAllow);return;
 }
 if([@[@"http",@"https",@"mailto"] containsObject:url.scheme]&&action.navigationType==WKNavigationTypeLinkActivated)[NSWorkspace.sharedWorkspace openURL:url];handler(WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {if(error.code!=NSURLErrorCancelled)[self splash:error.localizedDescription error:YES];}
- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {if(error.code!=NSURLErrorCancelled)[self splash:error.localizedDescription error:YES];}
- (void)webView:(WKWebView *)webView navigationAction:(WKNavigationAction *)action didBecomeDownload:(WKDownload *)download {download.delegate=self;}
- (void)webView:(WKWebView *)webView decidePolicyForNavigationResponse:(WKNavigationResponse *)response decisionHandler:(void (^)(WKNavigationResponsePolicy))handler {handler(response.canShowMIMEType?WKNavigationResponsePolicyAllow:WKNavigationResponsePolicyDownload);}
- (void)webView:(WKWebView *)webView navigationResponse:(WKNavigationResponse *)response didBecomeDownload:(WKDownload *)download {download.delegate=self;}
- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response suggestedFilename:(NSString *)name completionHandler:(void (^)(NSURL *))handler {NSSavePanel *panel=[NSSavePanel savePanel];panel.nameFieldStringValue=name;[panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result){handler(result==NSModalResponseOK?panel.URL:nil);}];}
- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))handler {NSAlert *alert=[NSAlert new];alert.messageText=message;[alert addButtonWithTitle:@"Continue"];[alert addButtonWithTitle:@"Cancel"];[alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response){handler(response==NSAlertFirstButtonReturn);}];}
- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))handler {NSAlert *alert=[NSAlert new];alert.messageText=message;[alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response){handler();}];}
@end
int main(int argc,const char *argv[]){@autoreleasepool{NSApplication *app=NSApplication.sharedApplication;JobDesk *delegate=[JobDesk new];app.delegate=delegate;[app setActivationPolicy:NSApplicationActivationPolicyRegular];[app run];}return 0;}
