// First-screen trajectory and timing from the supplied vanilla corridor reference.
const SLOT_TRAVEL = [0, 0.06, 0.145, 0.255, 0.375, 0.485, 0.585];
const SLOT_SCALE_RATIO = [0.1, 0.16, 0.27, 0.43, 0.68, 1, 1.35];
const SLOT_ROTATION = [12, 16, 21, 27, 33, 39, 45];
const TRACK_SPACING = 0.9;
const BIRTH_GROWTH_SLOTS = 1;
const PRE_PUSH_START_SLOT = 0.55;
const PRE_PUSH_END_SLOT = 1.85;
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
const MAX_VISIBLE_SLOT = 5.25;

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(Math.max(value, min), max);
const easeInOut = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const easeOut = (value: number) => 1 - Math.pow(1 - clamp(value), 3);
const easeIntoLinearMotion = (value: number) => {
  const t = clamp(value);
  return t * t * (2 - t);
};

function interpolateSlot(values: number[], slot: number) {
  const last = values.length - 1;
  if (slot >= last) {
    const step = values[last] - values[last - 1];
    return values[last] + step * (slot - last);
  }

  const lower = Math.max(Math.floor(slot), 0);
  const upper = Math.min(lower + 1, last);
  const mix = slot - lower;
  const mixSquared = mix * mix;
  const mixCubed = mixSquared * mix;

  const getSlope = (index: number) => {
    if (index === 0) return values[1] - values[0];
    if (index === last) return values[last] - values[last - 1];
    const before = values[index] - values[index - 1];
    const after = values[index + 1] - values[index];
    if (before === 0 || after === 0 || before * after < 0) return 0;
    return (2 * before * after) / (before + after);
  };

  const lowerSlope = getSlope(lower);
  const upperSlope = getSlope(upper);
  return (
    (2 * mixCubed - 3 * mixSquared + 1) * values[lower] +
    (mixCubed - 2 * mixSquared + mix) * lowerSlope +
    (-2 * mixCubed + 3 * mixSquared) * values[upper] +
    (mixCubed - mixSquared) * upperSlope
  );
}

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
const baseCardHeight=baseCardWidth*3/4; const outerScale=viewportHeight*.8/baseCardHeight; const centerScaleRatio=apertureHeight/(baseCardHeight*outerScale); const scaleRatios=[centerScaleRatio,...SLOT_SCALE_RATIO.slice(1)]; const prePushDistance=baseCardWidth*centerScaleRatio*outerScale; const streamPosition=getStreamPosition(elapsed); const imagesStarted=elapsed>=IMAGE_START;
    const rawStreamAge = streamPosition - pairIndex;
    const streamAge =
      rawStreamAge >= 0 ? rawStreamAge % STREAM_PAIR_COUNT : rawStreamAge;
    const prePushProgress = easeIntoLinearMotion(
      (streamAge - PRE_PUSH_START_SLOT) /
        (PRE_PUSH_END_SLOT - PRE_PUSH_START_SLOT),
    );
    const birthProgress = easeInOut(streamAge / BIRTH_GROWTH_SLOTS);
    const slot = Math.max(streamAge - PRE_PUSH_END_SLOT, 0);
    const birthScale = 0.2 + birthProgress * 0.8;
    const scale = interpolateSlot(scaleRatios, slot) * outerScale;
    const rotationSlot =
      clamp(slot / MAX_VISIBLE_SLOT) * (SLOT_ROTATION.length - 1);
    const rotation = interpolateSlot(SLOT_ROTATION, rotationSlot);
    const x =
      prePushDistance * prePushProgress +
      interpolateSlot(SLOT_TRAVEL, slot) * width * TRACK_SPACING;
    const visible =
      imagesStarted && streamAge >= 0 && slot <= MAX_VISIBLE_SLOT ? 1 : 0;

const direction=sideIndex===0?-1:1; return { transform:`translate3d(calc(${sideIndex===0?"-100%":"0%"} + ${direction*x}px),-50%,0) rotateY(${direction*-rotation}deg) scale(${scale}) scale(${birthScale})`, opacity:visible, zIndex:20+Math.round(clamp(slot,0,8)*10) };
}
export function apertureOpen(elapsed: number) { return easeOut((elapsed-BAR_START)/(BAR_END-BAR_START)); }
export function slideIndex(sequence: number,count: number) { return count ? ((sequence%count)+count)%count : 0; }
