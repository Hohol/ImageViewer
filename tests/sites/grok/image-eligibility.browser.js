Promise.resolve().then(() => {
  host = 'grok';
  expectEligibility(sample('<div class="group/grok-image"><img></div>'), true, 'Grok generated chat image');
  expectEligibility(sample('<div class="flex flex-col gap-2 group/grok-image"><img></div>'), true,
    'Grok generated-image exception inside generic block');
  expectEligibility(sample('<div data-lightbox-media><div data-media-frame><img></div></div>'), true,
    'Grok Imagine lightbox hero');
  expectEligibility(sample('<div data-lightbox-media><div data-media-frame><div data-filmstrip-item><img></div></div></div>'), false,
    'Grok filmstrip thumbnail');
  expectEligibility(sample('<div class="group rounded-2xl"><div class="grid"><img class="col-start-1 row-start-1"></div></div>'), true,
    'Grok legacy Imagine card');
  expectEligibility(sample('<main><article><div class="grid"><img class="col-start-1 row-start-1"></div></article></main>'), true,
    'Grok Imagine post hero');
  for (const [container, label] of [
    ['<div role="listitem">', 'masonry thumbnail'],
    ['<div class="backdrop-blur-md">', 'feedback image'],
    ['<div class="compact-card">', 'compact card'],
  ]) {
    expectEligibility(sample(container + '<div class="group/grok-image"><img></div></div>'), false, label);
  }
  expectEligibility(sample(), false, 'unrecognized Grok image');
}).then(() => finish()).catch(finish);
