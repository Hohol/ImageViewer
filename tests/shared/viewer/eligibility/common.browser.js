Promise.resolve().then(() => {
  expectEligibility(sample(), true, 'ordinary chat image is eligible');
  for (const [markup, attributes, label] of [
    ['<img>', { alt: 'User' }, 'user avatar'],
    ['<img>', { alt: 'pfp' }, 'profile avatar'],
    ['<img>', { alt: 'Thumbnail 2' }, 'thumbnail alt'],
    ['<img>', { src: 'https://example.test/preview-image' }, 'preview URL'],
    ['<img>', { src: 'https://example.test/preview_image.jpg' }, 'preview filename'],
    ['<img>', { style: 'opacity:0.4' }, 'transition placeholder'],
    ['<div class="blur-2xl"><img></div>', {}, 'blurred background'],
    ['<div class="compact-card"><img></div>', {}, 'compact card'],
    ['<button aria-label="Favorites"><img></button>', {}, 'Favorites thumbnail'],
    ['<div role="listitem"><img></div>', {}, 'gallery list item'],
    ['<button class="preview-image-button"><img></button>', {}, 'upload preview'],
    ['<div class="backdrop-blur-md"><img></div>', {}, 'feedback overlay'],
    ['<div class="flex flex-col gap-2"><img></div>', {}, 'generic image block'],
    ['<div><button aria-label="Open profile menu"></button><img></div>', {}, 'ChatGPT profile menu image'],
  ]) {
    expectEligibility(sample(markup, attributes), false, label + ' is excluded');
  }
  expectEligibility(sample('<img>', { style: 'opacity:0.5' }), true, 'opacity threshold remains inclusive');
  const generated = sample('<div class="flex flex-col gap-2"><button data-testid="generated-image-preview"><img><span>Open</span></button></div>');
  expectEligibility(generated, true, 'ChatGPT generated-image exception is preserved');
  check(imageFromEventTarget(samples.querySelector('span')) === generated,
    'clicking the generated-image button resolves its eligible image');
  // An explicit generated preview must not bypass exclusions such as feedback UI.
  expectEligibility(sample('<div class="backdrop-blur-md"><button data-testid="generated-image-preview"><img></button></div>'),
    false, 'generated-image marker does not override feedback exclusion');
}).then(() => finish()).catch(finish);
