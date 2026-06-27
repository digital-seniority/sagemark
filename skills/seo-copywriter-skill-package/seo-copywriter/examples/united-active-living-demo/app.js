// Whispering Willows demo — light interactions
(function () {
  // Close the mobile nav when a link inside it is tapped
  var nav = document.getElementById('nav');
  if (nav) {
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') nav.classList.remove('open');
    });
  }

  // Accordion FAQ: allow only one open at a time (nicer on mobile)
  var faqs = document.querySelectorAll('.faq details');
  faqs.forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) {
        faqs.forEach(function (o) { if (o !== d) o.open = false; });
      }
    });
  });

  // Subtle reveal-on-scroll
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.style.opacity = 1; en.target.style.transform = 'none'; io.unobserve(en.target); }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('[data-reveal]').forEach(function (el) {
      el.style.opacity = 0; el.style.transform = 'translateY(14px)';
      el.style.transition = 'opacity .6s ease, transform .6s ease';
      io.observe(el);
    });
  }
})();
