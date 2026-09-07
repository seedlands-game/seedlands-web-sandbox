<script lang="ts">
  import { onMount } from 'svelte';

  const messages = [
    '正在寻找一块不会把营地种进河里的土地…',
    '给远山留出一点呼吸的距离…',
    '正在把第一束阳光放到树梢上…',
    '提醒附近的生灵：有旅行者要来了…',
    '正在编织初始区块与地形边界…',
    '最后检查一次背包里有没有多余的石头…',
  ];
  let messageIndex = $state(0);
  onMount(() => {
    const timer = window.setInterval(() => (messageIndex = (messageIndex + 1) % messages.length), 1_350);
    return () => window.clearInterval(timer);
  });
</script>

<section class="world-loading" data-world-loading aria-live="polite" aria-busy="true">
  <div class="loading-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
  <p class="eyebrow">WORLD GENERATION IN PROGRESS</p>
  <h2>世界正在醒来</h2>
  <p class="loading-message">{messages[messageIndex]}</p>
  <div class="loading-track" aria-hidden="true"><span></span></div>
  <small>资源与初始区块全部 ready 后才会开放旅程</small>
</section>
