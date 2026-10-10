Promise.resolve().then(() => {
  // Reduced from the saved layout: the pressable button is a sibling overlay,
  // not an ancestor of the image. Omit hashed classes and real article content.
  const card = '<div data-d-component="image" class="group/search-image">' +
    '<img><div><button data-d-component="pressable" aria-label="Open Sample article" type="button"></button></div></div>';
  expectEligibility(sample(card), false, 'ChatGPT search-image card is excluded');
  check(imageFromEventTarget(samples.querySelector('button')) === null,
    'search-card overlay keeps its native click behavior');
  expectEligibility(sample('<div data-d-component="image"><img></div>'), true,
    'generic image component remains eligible');
  expectEligibility(sample('<button data-d-component="pressable" aria-label="Open Sample image"><img></button>'), true,
    'generic Open button does not imply a search-image card');
  expectEligibility(sample('<button data-testid="generated-image-preview"><img></button>'), true,
    'generated ChatGPT image remains eligible');
  host = 'grok';
  expectEligibility(sample('<div class="group/grok-image">' + card + '</div>'), true,
    'ChatGPT search-card rule does not affect other sites');
}).then(() => finish()).catch(finish);
