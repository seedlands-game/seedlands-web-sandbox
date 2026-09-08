import {
  MAX_GLB_ANIMATION_CHANNELS,
  MAX_GLB_ANIMATION_CLIPS,
  MAX_GLB_ANIMATION_KEYFRAMES,
  MAX_GLB_ANIMATION_SECONDS,
  type GlbAnimationClip,
} from './glb-model-contract';
import {
  array,
  componentValue,
  fail,
  indexedObject,
  integer,
  isObject,
  validateAccessor,
  validateFiniteAccessor,
  type AccessorScanCache,
  type Json,
  type JsonObject,
} from './glb-model-document';

export function validateAnimations(
  document: JsonObject,
  nodes: Json[],
  accessors: Json[],
  bufferViews: JsonObject[],
  binary: Uint8Array,
  scans: AccessorScanCache,
): GlbAnimationClip[] {
  const animations = array(document, 'animations');
  if (animations.length > MAX_GLB_ANIMATION_CLIPS) fail(`GLB 动画片段超过 ${MAX_GLB_ANIMATION_CLIPS} 上限`);
  const names = new Set<string>();
  let totalChannels = 0;
  let totalKeyframes = 0;
  return animations.map((animation, animationIndex) => {
    const animationObject = isObject(animation) ? animation : fail(`GLB 动画 ${animationIndex} 格式无效`);
    const name =
      typeof animationObject.name === 'string' ? animationObject.name : fail('GLB 动画片段名称缺失、重复或过长');
    if (!name.trim() || name.length > 120 || names.has(name)) fail('GLB 动画片段名称缺失、重复或过长');
    names.add(name);
    const samplers = array(animationObject, 'samplers');
    const channels = array(animationObject, 'channels');
    if (!samplers.length || !channels.length) fail(`GLB 动画 ${name} 缺少 sampler 或 channel`);
    totalChannels += channels.length;
    if (totalChannels > MAX_GLB_ANIMATION_CHANNELS) fail(`GLB 动画通道超过 ${MAX_GLB_ANIMATION_CHANNELS} 上限`);
    const checkedSamplers = samplers.map((sampler, samplerIndex) => {
      const samplerObject = isObject(sampler) ? sampler : fail(`GLB 动画 ${name} sampler ${samplerIndex} 格式无效`);
      const interpolation = samplerObject.interpolation ?? 'LINEAR';
      if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(interpolation as string))
        fail(`GLB 动画 ${name} interpolation 不受支持`);
      const inputIndex = integer(samplerObject.input, `GLB 动画 ${name} input 无效`);
      const input = validateAccessor(accessors, bufferViews, binary, inputIndex, `动画 ${name} input`);
      const outputIndex = integer(samplerObject.output, `GLB 动画 ${name} output 无效`);
      const output = validateAccessor(accessors, bufferViews, binary, outputIndex, `动画 ${name} output`);
      if (input.componentType !== 5126 || input.type !== 'SCALAR' || input.count < 2)
        fail(`GLB 动画 ${name} input 必须是至少两个 FLOAT SCALAR 时间点`);
      if (output.componentType !== 5126) fail(`GLB 动画 ${name} output 必须使用 FLOAT`);
      const expected = interpolation === 'CUBICSPLINE' ? input.count * 3 : input.count;
      if (output.count !== expected) fail(`GLB 动画 ${name} sampler 输入输出数量不匹配`);
      validateFiniteAccessor(outputIndex, output, binary, scans, `动画 ${name} output`);
      let previous = scans.timeDuration.get(inputIndex);
      if (previous === undefined) {
        const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
        previous = -Infinity;
        for (let keyframe = 0; keyframe < input.count; keyframe++) {
          const time = componentValue(data, 5126, input.start + keyframe * input.stride);
          if (!Number.isFinite(time) || time < 0 || time <= previous) fail(`GLB 动画 ${name} 时间点必须有限且严格递增`);
          previous = time;
        }
        scans.timeDuration.set(inputIndex, previous);
      }
      if (previous > MAX_GLB_ANIMATION_SECONDS) fail(`GLB 动画 ${name} 时长超过 ${MAX_GLB_ANIMATION_SECONDS} 秒上限`);
      totalKeyframes += input.count;
      if (totalKeyframes > MAX_GLB_ANIMATION_KEYFRAMES)
        fail(`GLB 动画关键帧超过 ${MAX_GLB_ANIMATION_KEYFRAMES.toLocaleString()} 上限`);
      return { output, durationSeconds: previous };
    });
    const targets = new Set<string>();
    channels.forEach((channel, channelIndex) => {
      const channelObject = isObject(channel) ? channel : fail(`GLB 动画 ${name} channel ${channelIndex} 格式无效`);
      const samplerIndex = integer(channelObject.sampler, `GLB 动画 ${name} channel sampler 无效`);
      const sampler = checkedSamplers[samplerIndex];
      if (!sampler) fail(`GLB 动画 ${name} channel 引用了不存在的 sampler`);
      const target = isObject(channelObject.target)
        ? channelObject.target
        : fail(`GLB 动画 ${name} channel target 格式无效`);
      const node = integer(target.node, `GLB 动画 ${name} target node 无效`);
      indexedObject(nodes, node, `GLB 动画 ${name} target node 不存在`);
      const path = target.path;
      if (path !== 'translation' && path !== 'rotation' && path !== 'scale')
        fail(`GLB 动画 ${name} 仅支持 translation、rotation 和 scale`);
      const expectedType = path === 'rotation' ? 'VEC4' : 'VEC3';
      if (sampler.output.type !== expectedType) fail(`GLB 动画 ${name} ${path} output 必须是 ${expectedType}`);
      const key = `${node}:${path}`;
      if (targets.has(key)) fail(`GLB 动画 ${name} 对同一 node/path 重复写入`);
      targets.add(key);
    });
    return { name, durationSeconds: Math.max(...checkedSamplers.map((sampler) => sampler.durationSeconds)) };
  });
}
