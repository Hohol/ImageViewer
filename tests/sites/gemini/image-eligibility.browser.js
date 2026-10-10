Promise.resolve().then(() => {
  host = 'gemini';
  const generated = { src: 'https://lh3.googleusercontent.com/result', class: 'image', alt: 'AI generated' };
  expectEligibility(sample('<img>', generated), true, 'Gemini inline generated image');
  expectEligibility(sample('<div class="flex flex-col gap-2"><img></div>', generated), true,
    'Gemini generated-image exception inside generic block');
  expectEligibility(sample('<img>', { ...generated, src: 'blob:https://gemini.google.com/fixture' }), true,
    'Gemini generated blob image');
  expectEligibility(sample('<img>', { ...generated, src: 'https://example.test/result' }), false,
    'unrecognized image source');
  expectEligibility(sample('<img>', { ...generated, alt: 'Uploaded image' }), false, 'non-generated inline image');
  expectEligibility(sample('<img>', { ...generated, class: '' }), false, 'non-result image markup');
  expectEligibility(sample('<button class="preview-image-button"><img></button>', generated), false,
    'upload preview even with generated-image attributes');
  expectEligibility(sample('<div role="dialog"><div class="arrow-back-container"></div><div class="image-title"></div><img></div>',
    { src: generated.src }), true, 'Gemini lightbox image without inline attributes');
}).then(() => finish()).catch(finish);
