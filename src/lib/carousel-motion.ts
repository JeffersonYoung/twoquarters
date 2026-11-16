// Paired 4:3 images travel inward and grow, then yield to the next arrival.
const BAR_START = 180;
const BAR_END = 900;
const IMAGE_REVEAL_PROGRESS = 0.8;
const IMAGE_START =
  BAR_START +
  (BAR_END - BAR_START) * (1 - Math.cbrt(1 - IMAGE_REVEAL_PROGRESS));
const FILL_DURATION = 1000;
const FILLED_STREAM_POSITION = 6;
const STEADY_SPEED = 1.25 * (2 / 3);
const INITIAL_SPEED =
  (2 * FILLED_STREAM_POSITION) / (FILL_DURATION / 1000) - STEADY_SPEED;
const DECELERATION =
  (STEADY_SPEED - INITIAL_SPEED) / (FILL_DURATION / 1000);
const STREAM_PAIR_COUNT = 32;

const clamp=(value: number)=>Math.min(1,Math.max(0,value));
const easeOut=(value: number)=>1-Math.pow(1-clamp(value),3);
export function getStreamPosition(elapsed: number) {
  const motionElapsed = Math.max(elapsed - IMAGE_START, 0) / 1000;
  const fillSeconds = FILL_DURATION / 1000;
  if (motionElapsed <= fillSeconds) {
    return (
      INITIAL_SPEED * motionElapsed +
      0.5 * DECELERATION * motionElapsed * motionElapsed
    );
  }
  return FILLED_STREAM_POSITION + (motionElapsed - fillSeconds) * STEADY_SPEED;
}



export function carouselFrame(pairIndex: number, sideIndex: number, elapsed: number, width: number, viewportHeight: number, baseCardWidth: number, apertureHeight: number) {
  // Stagger the two sides so each image has its own turn at the center.
  const rawAge=getStreamPosition(elapsed)-pairIndex-sideIndex*.5;
  const age=rawAge>=0 ? rawAge%STREAM_PAIR_COUNT : rawAge;
  const progress=clamp(age/6);
  const eased=progress*progress*(3-2*progress);
  const direction=sideIndex===0?-1:1;
  const x=direction*width*.62*(1-eased);
  const finalWidth=Math.min(width*.72,viewportHeight*.8*4/3);
  const startWidth=Math.min(apertureHeight/3,finalWidth*.04);
  // Keep edge cards small; reserve most growth for the approach to the center.
  const growth=eased*eased;
  const scale=(startWidth+(finalWidth-startWidth)*growth)/baseCardWidth;
  const rotation=-direction*40*(1-eased);
  const opacity=elapsed<IMAGE_START || age<0 ? 0 : clamp(age/.35)*(1-clamp((age-6.15)/.65));
  return {transform:`translate3d(calc(-50% + ${x}px),-50%,0) rotateY(${rotation}deg) scale(${scale})`,opacity,zIndex:20+Math.round(Math.min(age,6)*10)};
}
export function apertureOpen(elapsed: number) { return easeOut((elapsed-BAR_START)/(BAR_END-BAR_START)); }
export function slideIndex(sequence: number,count: number) { return count ? ((sequence%count)+count)%count : 0; }
