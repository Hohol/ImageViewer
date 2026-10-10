Promise.resolve().then(() => {
  const svg = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80"/></svg>');
  expectEligibility(sample('<img data-d-component="svg" alt="">', { src: svg }), false,
    'ChatGPT inline SVG component is excluded');
  expectEligibility(sample('<img>', { src: svg }), true,
    'ordinary SVG images remain eligible');
}).then(() => finish()).catch(finish);
