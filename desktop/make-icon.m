#import <Cocoa/Cocoa.h>
int main(int argc,const char *argv[]){@autoreleasepool{
 NSString *directory=@(argv[1]);[NSFileManager.defaultManager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
 NSMutableSet *seen=[NSMutableSet new];NSMutableArray *points=[NSMutableArray new];double maxT=2.2*M_PI*2;
 for(double t=0;t<=maxT;t+=.02){double r=.9*exp(log(7/.9)/maxT*t),x=round(9+r*cos(t)),y=round(8+r*sin(t));NSString *key=[NSString stringWithFormat:@"%g,%g",x,y];if(x>=0&&x<18&&y>=0&&y<16&&![seen containsObject:key]){[seen addObject:key];[points addObject:@[@(x),@(y)]];}}
 for(NSNumber *number in @[@16,@32,@64,@128,@256,@512,@1024]){NSInteger size=number.integerValue;double n=size;NSBitmapImageRep *bitmap=[[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:size pixelsHigh:size bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];[NSGraphicsContext saveGraphicsState];NSGraphicsContext.currentContext=[NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
 [[NSColor colorWithCalibratedWhite:.035 alpha:1] setFill];[[NSBezierPath bezierPathWithRoundedRect:NSMakeRect(n*.07,n*.07,n*.86,n*.86) xRadius:n*.19 yRadius:n*.19] fill];[[NSColor colorWithCalibratedWhite:.9 alpha:1] setFill];
 for(NSArray *point in points){double x=[point[0] doubleValue],y=[point[1] doubleValue],r=MAX(n*.0105,.55);[[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(n*(.22+x*.033)-r,n*(.77-y*.033)-r,r*2,r*2)] fill];}
 [NSGraphicsContext restoreGraphicsState];NSData *png=[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];if(size<=512)[png writeToFile:[directory stringByAppendingPathComponent:[NSString stringWithFormat:@"icon_%ldx%ld.png",size,size]] atomically:YES];if(size>=32)[png writeToFile:[directory stringByAppendingPathComponent:[NSString stringWithFormat:@"icon_%ldx%ld@2x.png",size/2,size/2]] atomically:YES];
 }
}return 0;}
