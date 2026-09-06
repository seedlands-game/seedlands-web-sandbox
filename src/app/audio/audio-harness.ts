import type { GlobalAudio } from './global-audio';

/** 仅观测生产混音结果；不向 Harness 暴露伪造成功事件的入口。 */
export function installAudioHarness(audio: GlobalAudio) {
  if (!new URLSearchParams(location.search).has('harness')) return;
  Object.assign(window, {
    __seedlandsAudio: {
      snapshot: () => audio.snapshot(),
      capture: (seconds: number) => {
        const graph = audio.graph;
        if (!graph) return Promise.reject(new Error('音频未解锁'));
        const destination = graph.context.createMediaStreamDestination();
        graph.output.connect(destination);
        const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' });
        const chunks: Blob[] = [];
        return new Promise<number[]>((resolve, reject) => {
          const dispose = () => {
            graph.output.disconnect(destination);
            destination.stream.getTracks().forEach((track) => track.stop());
          };
          recorder.ondataavailable = (event) => {
            if (event.data.size) chunks.push(event.data);
          };
          recorder.onerror = () => {
            dispose();
            reject(new Error('生产音频录制失败'));
          };
          recorder.onstop = () => {
            dispose();
            void new Blob(chunks).arrayBuffer().then((buffer) => resolve(Array.from(new Uint8Array(buffer))));
          };
          recorder.start();
          setTimeout(
            () => {
              if (recorder.state === 'recording') recorder.stop();
            },
            Math.min(10, Math.max(0.2, seconds)) * 1000,
          );
        });
      },
    },
  });
}
