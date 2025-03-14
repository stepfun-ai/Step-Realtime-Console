<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<svelte:head>
  <title>阶跃星辰 Realtime API 接口前端使用样例</title>
</svelte:head>

{@render children()}
