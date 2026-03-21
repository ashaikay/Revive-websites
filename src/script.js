/**
 * Premium Web Design Studio - Main JavaScript
 * Handles: Navigation, Animations, Form Validation, FAQ Accordion
 */

// =============================================
// DOM READY
// =============================================

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initScrollReveal();
  initFAQAccordion();
  initQuoteForm();
  initSmoothScroll();
});

// =============================================
// NAVIGATION
// =============================================

function initNavigation() {
  const navbar = document.querySelector('.navbar');
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.querySelector('.nav-menu');
  const mobileOverlay = document.querySelector('.mobile-overlay');
  const navLinks = document.querySelectorAll('.nav-menu a');

  // Scroll effect for navbar
  let lastScroll = 0;
  
  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;
    
    // Add scrolled class when past threshold
    if (currentScroll > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
    
    lastScroll = currentScroll;
  });

  // Mobile menu toggle
  if (navToggle) {
    navToggle.addEventListener('click', () => {
      navToggle.classList.toggle('active');
      navMenu.classList.toggle('active');
      mobileOverlay?.classList.toggle('active');
      document.body.style.overflow = navMenu.classList.contains('active') ? 'hidden' : '';
    });
  }

  // Close mobile menu on overlay click
  if (mobileOverlay) {
    mobileOverlay.addEventListener('click', closeMobileMenu);
  }

  // Close mobile menu on link click
  navLinks.forEach(link => {
    link.addEventListener('click', closeMobileMenu);
  });

  function closeMobileMenu() {
    navToggle?.classList.remove('active');
    navMenu?.classList.remove('active');
    mobileOverlay?.classList.remove('active');
    document.body.style.overflow = '';
  }

  // Close on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navMenu?.classList.contains('active')) {
      closeMobileMenu();
    }
  });
}

// =============================================
// SCROLL REVEAL ANIMATIONS
// =============================================

function initScrollReveal() {
  const revealElements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale, .stagger');
  
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        // Optionally unobserve after revealing
        // observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  revealElements.forEach(el => observer.observe(el));
}

// =============================================
// SMOOTH SCROLL
// =============================================

function initSmoothScroll() {
  const anchors = document.querySelectorAll('a[href^="#"]');
  
  anchors.forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      
      if (href === '#') return;
      
      const target = document.querySelector(href);
      
      if (target) {
        e.preventDefault();
        
        const navHeight = document.querySelector('.navbar')?.offsetHeight || 80;
        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navHeight;
        
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
}

// =============================================
// FAQ ACCORDION
// =============================================

function initFAQAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');
  
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    
    question?.addEventListener('click', () => {
      const isActive = item.classList.contains('active');
      
      // Close all other items
      faqItems.forEach(otherItem => {
        if (otherItem !== item) {
          otherItem.classList.remove('active');
        }
      });
      
      // Toggle current item
      item.classList.toggle('active');
    });
  });
}

// =============================================
// MULTI-STEP QUOTE FORM
// =============================================

function initQuoteForm() {
  const form = document.getElementById('quote-form');
  if (!form) return;

  const steps = form.querySelectorAll('.form-step');
  const progressSteps = document.querySelectorAll('.progress-step');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const submitBtn = document.getElementById('submit-btn');
  const formSuccess = document.querySelector('.form-success');
  
  let currentStep = 0;

  // Initialize
  updateForm();

  // Next button
  nextBtn?.addEventListener('click', () => {
    if (validateStep(currentStep)) {
      currentStep++;
      updateForm();
    }
  });

  // Previous button
  prevBtn?.addEventListener('click', () => {
    currentStep--;
    updateForm();
  });

  // Form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateStep(currentStep)) return;

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    // Collect form data
    const formData = new FormData(form);
    
    // Build explicit payload object
    const payload = {
      full_name: formData.get("full_name"),
      business_name: formData.get("business_name") || null,
      email: formData.get("email"),
      phone: formData.get("phone") || null,
      contact_method: formData.get("contact_method") || "email",

      project_type: formData.get("project_type") || null,
      current_url: formData.get("current_url") || null,
      business_type: formData.get("business_type") || null,
      target_audience: formData.get("target_audience") || null,
      page_count: formData.get("page_count") || null,
      budget: formData.get("budget") || null,

      selected_package: formData.get("selected_package") || null,
      payment_option: formData.get("payment_option") || null,
      maintenance_plan: formData.get("maintenance_plan") || null,
      design_addons: formData.getAll("design_addons"),

      pages_needed: formData.getAll("pages_needed"),
      features_needed: formData.getAll("features_needed"),
      branding_ready: formData.get("branding_ready") || null,
      content_ready: formData.get("content_ready") || null,
      assets_ready: formData.get("assets_ready") || null,

      launch_date: formData.get("launch_date") || null,
      start_soon: formData.get("start_soon") || null,
      deposit_ok: formData.get("deposit_ok") || null,
      project_details: formData.get("project_details") || null
    };

    // Supabase integration
    try {
      if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase) {
        const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
        const { error } = await supabase.from('quotes').insert([payload]);
        if (error) throw error;
      }
      // Show success state
      form.style.display = 'none';
      document.querySelector('.form-progress').style.display = 'none';
      formSuccess.classList.add('active');
    } catch (error) {
      console.error('Form submission error:', error);
      alert('There was an error submitting your request. Please try again or email us directly.');
    } finally {
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Request';
    }
  });

  function updateForm() {
    // Update step visibility
    steps.forEach((step, index) => {
      step.classList.toggle('active', index === currentStep);
    });
    
    // Update progress indicators
    progressSteps.forEach((step, index) => {
      step.classList.remove('active', 'completed');
      if (index === currentStep) {
        step.classList.add('active');
      } else if (index < currentStep) {
        step.classList.add('completed');
      }
    });
    
    // Update buttons
    if (prevBtn) prevBtn.style.display = currentStep === 0 ? 'none' : 'inline-flex';
    if (nextBtn) nextBtn.style.display = currentStep === steps.length - 1 ? 'none' : 'inline-flex';
    if (submitBtn) submitBtn.style.display = currentStep === steps.length - 1 ? 'inline-flex' : 'none';
    
    // Scroll form into view
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function validateStep(stepIndex) {
    const currentStepEl = steps[stepIndex];
    let isValid = true;
    
    // Clear previous errors
    currentStepEl.querySelectorAll('.form-error').forEach(el => el.remove());
    currentStepEl.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
    
    // Validate required fields
    const requiredFields = currentStepEl.querySelectorAll('[required]');
    
    requiredFields.forEach(field => {
      if (!field.value.trim()) {
        isValid = false;
        showError(field, 'This field is required');
      } else if (field.type === 'email' && !isValidEmail(field.value)) {
        isValid = false;
        showError(field, 'Please enter a valid email address');
      } else if (field.type === 'tel' && field.value && !isValidPhone(field.value)) {
        isValid = false;
        showError(field, 'Please enter a valid phone number');
      } else if (field.type === 'url' && field.value && !isValidUrl(field.value)) {
        isValid = false;
        showError(field, 'Please enter a valid URL');
      }
    });
    
    return isValid;
  }

  function showError(field, message) {
    field.classList.add('error');
    const error = document.createElement('div');
    error.className = 'form-error';
    error.textContent = message;
    field.parentNode.appendChild(error);
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function isValidPhone(phone) {
    return /^[\d\s\-+()]{7,20}$/.test(phone);
  }

  function isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return /^[\w\-.]+(\.[\w\-]+)+/.test(url);
    }
  }
}

// =============================================
// UTILITY FUNCTIONS
// =============================================

/**
 * Debounce function for performance optimization
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function for scroll handlers
 */
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// =============================================
// ADDITIONAL INTERACTIONS
// =============================================

// Add hover effect to portfolio cards on touch devices
document.addEventListener('touchstart', function() {}, { passive: true });

// Handle form input animations
document.querySelectorAll('.form-input, .form-textarea').forEach(input => {
  input.addEventListener('focus', function() {
    this.parentElement?.classList.add('focused');
  });
  
  input.addEventListener('blur', function() {
    this.parentElement?.classList.remove('focused');
    if (this.value) {
      this.parentElement?.classList.add('has-value');
    } else {
      this.parentElement?.classList.remove('has-value');
    }
  });
});

// Keyboard navigation improvements
document.addEventListener('keydown', (e) => {
  // Add focus styles for keyboard navigation
  if (e.key === 'Tab') {
    document.body.classList.add('keyboard-nav');
  }
});

document.addEventListener('mousedown', () => {
  document.body.classList.remove('keyboard-nav');
});

// =============================================
// PERFORMANCE: Lazy load images when needed
// =============================================

if ('IntersectionObserver' in window) {
  const lazyImages = document.querySelectorAll('img[data-src]');
  
  const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        imageObserver.unobserve(img);
      }
    });
  });
  
  lazyImages.forEach(img => imageObserver.observe(img));
}

// =============================================
// EXPORT FOR MODULE USE (if needed)
// =============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initNavigation,
    initScrollReveal,
    initFAQAccordion,
    initQuoteForm,
    initSmoothScroll
  };
}
