// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        
        const targetId = this.getAttribute('href');
        const targetElement = document.querySelector(targetId);
        
        if (targetElement) {
            window.scrollTo({
                top: targetElement.offsetTop - 70,
                behavior: 'smooth'
            });
        }
    });
});

// Add scroll animation to elements
const animateOnScroll = () => {
    const elements = document.querySelectorAll('.feature-card, .step, .faq-item, .spec-card');
    
    elements.forEach(element => {
        const elementPosition = element.getBoundingClientRect().top;
        const screenPosition = window.innerHeight / 1.3;
        
        if (elementPosition < screenPosition) {
            element.style.opacity = 1;
            element.style.transform = 'translateY(0)';
        }
    });
};

// Set initial state for animated elements
const setInitialAnimationState = () => {
    const elements = document.querySelectorAll('.feature-card, .step, .faq-item, .spec-card');
    
    elements.forEach(element => {
        element.style.opacity = 0;
        element.style.transform = 'translateY(30px)';
        element.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    });
};

// Initialize animations
window.addEventListener('DOMContentLoaded', setInitialAnimationState);
window.addEventListener('scroll', animateOnScroll);
// Trigger on load in case elements are already in view
window.addEventListener('load', animateOnScroll);

// Header scroll effect
window.addEventListener('scroll', function() {
    const header = document.querySelector('header');
    if (window.scrollY > 50) {
        header.style.boxShadow = '0 5px 20px rgba(0, 0, 0, 0.1)';
        header.style.background = 'rgba(255, 255, 255, 0.95)';
        header.style.transform = 'translateY(-2px)';
    } else {
        header.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
        header.style.background = '#fff';
        header.style.transform = 'translateY(0)';
    }
});

// Download button animation
const downloadBtn = document.querySelector('.download-btn');
if (downloadBtn) {
    downloadBtn.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-5px)';
    });
    
    downloadBtn.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0)';
    });
}

// Mobile menu toggle functionality
const menuToggle = document.getElementById('menuToggle');
const navMenu = document.getElementById('navMenu');
const floatingMenuToggle = document.getElementById('floatingMenuToggle');

// Function to toggle menu state
function toggleMenu() {
    if (menuToggle) menuToggle.classList.toggle('active');
    if (navMenu) navMenu.classList.toggle('active');
    if (floatingMenuToggle) floatingMenuToggle.classList.toggle('active');
}

// Function to close menu
function closeMenu() {
    if (menuToggle) menuToggle.classList.remove('active');
    if (navMenu) navMenu.classList.remove('active');
    if (floatingMenuToggle) floatingMenuToggle.classList.remove('active');
}

if (menuToggle && navMenu) {
    menuToggle.addEventListener('click', function(e) {
        e.stopPropagation(); // Prevent event from bubbling to document
        toggleMenu();
    });
    
    // Close menu when clicking on a link
    const navLinks = navMenu.querySelectorAll('a');
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            closeMenu();
        });
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', function(event) {
        // Check if the clicked element is inside the nav or toggle button
        const isClickInsideNav = navMenu.contains(event.target);
        const isClickInsideToggle = menuToggle.contains(event.target);
        
        // If the click is outside both the nav and toggle button, and the nav is active
        if (!isClickInsideNav && !isClickInsideToggle && navMenu.classList.contains('active')) {
            closeMenu();
        }
    });
    
    // Prevent clicks inside the nav from closing it
    navMenu.addEventListener('click', function(event) {
        event.stopPropagation();
    });
}

// Floating menu toggle functionality
if (floatingMenuToggle) {
    floatingMenuToggle.addEventListener('click', function(e) {
        e.stopPropagation(); // Prevent event from bubbling to document
        toggleMenu();
    });
}
