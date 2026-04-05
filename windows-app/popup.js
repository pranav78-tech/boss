const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', function() {
  console.log('Popup DOM loaded');
  
  const statusDiv = document.getElementById('status');
  const extractedTextDiv = document.getElementById('extractedText');
  const copyStatusDiv = document.getElementById('copyStatus');
  const copyBtn = document.getElementById('copyBtn');
  
  // Close popup when close button is clicked (will be handled by main process)
  
  // Copy text when copy button is clicked
  if (copyBtn && extractedTextDiv) {
    copyBtn.addEventListener('click', () => {
      const textToCopy = extractedTextDiv.textContent;
      copyTextToClipboard(textToCopy);
    });
  }
  
  // Listen for results from main process
  ipcRenderer.on('display-result', (event, result) => {
    console.log('Result received:', result);
    displayResponse(result);
  });
  
  // Function to display response
  function displayResponse(response) {
    console.log('Displaying response');
    let textToDisplay = '';
    
    // Prefer AI answers if available, otherwise use extracted text
    if (response.aiAnswers && response.aiAnswers !== 'No AI answers available') {
      // Check if the response contains "No relevant questions found." but has more content after it
      if (response.aiAnswers.startsWith('No relevant questions found.') && response.aiAnswers.length > 'No relevant questions found.'.length) {
        // Display the full response including the solution after "No relevant questions found."
        textToDisplay = response.aiAnswers;
      } else if (response.aiAnswers !== 'No relevant questions found.') {
        // Display the response if it doesn't start with "No relevant questions found."
        textToDisplay = response.aiAnswers;
      } else {
        // Only "No relevant questions found." - try extracted text
        textToDisplay = response.extractedText || 'No relevant questions found.';
      }
    } else if (response.extractedText) {
      textToDisplay = response.extractedText;
    } else {
      textToDisplay = 'No content available';
    }
    
    // Display in the popup
    if (extractedTextDiv) {
      extractedTextDiv.textContent = textToDisplay;
      // Scroll to top left to ensure both vertical and horizontal scroll positions are reset
      extractedTextDiv.scrollTop = 0;
      extractedTextDiv.scrollLeft = 0;
      
      // Add a small delay to ensure content is rendered before scrolling
      setTimeout(() => {
        extractedTextDiv.scrollTop = 0;
        extractedTextDiv.scrollLeft = 0;
      }, 10);
    }
    
    updateStatus('Analysis complete!', 'success');
    
    // Show copy status as information only
    if (copyStatusDiv) {
      copyStatusDiv.textContent = 'Response displayed';
      copyStatusDiv.style.display = 'block';
      
      // Hide copy status after 2 seconds
      setTimeout(() => {
        copyStatusDiv.style.display = 'none';
      }, 2000);
    }
  }
  
  // Function to update status message
  function updateStatus(message, type) {
    console.log('Updating status:', message, type);
    if (statusDiv) {
      statusDiv.textContent = message;
      statusDiv.className = type;
      statusDiv.style.display = 'block';
      
      // Hide status after 3 seconds
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 3000);
    }
  }
  
  // Function to copy text to clipboard
  function copyTextToClipboard(text) {
    console.log('Copying text to clipboard:', text);
    
    // Try using the modern clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        console.log('Text copied to clipboard using Clipboard API');
        showCopyStatus('Text copied to clipboard!');
      }).catch(err => {
        console.error('Failed to copy text using Clipboard API:', err);
        // Fallback to document.execCommand
        fallbackCopyTextToClipboard(text);
      });
    } else {
      // Fallback to document.execCommand
      fallbackCopyTextToClipboard(text);
    }
  }
  
  // Fallback method for copying text to clipboard
  function fallbackCopyTextToClipboard(text) {
    console.log('Using fallback method to copy text');
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      
      // Avoid scrolling to bottom
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        console.log('Text copied to clipboard using fallback method');
        showCopyStatus('Text copied to clipboard!');
      } else {
        console.error('Failed to copy text using fallback method');
        showCopyStatus('Failed to copy text');
      }
    } catch (error) {
      console.error('Error in fallback copy method:', error);
      showCopyStatus('Failed to copy text');
    }
  }
  
  // Function to show copy status
  function showCopyStatus(message) {
    console.log('Showing copy status:', message);
    if (copyStatusDiv) {
      copyStatusDiv.textContent = message;
      copyStatusDiv.style.display = 'block';
      copyStatusDiv.style.backgroundColor = '#d4edda'; // Green background for success
      copyStatusDiv.style.color = '#155724'; // Dark green text
      
      // Hide copy status after 3 seconds
      setTimeout(() => {
        copyStatusDiv.style.display = 'none';
      }, 3000);
    }
  }
});
