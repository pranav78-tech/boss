// Logs page functionality
document.addEventListener('DOMContentLoaded', function() {
    const tokenInput = document.getElementById('tokenInput');
    const fetchLogsBtn = document.getElementById('fetchLogsBtn');
    const logsContainer = document.getElementById('logsContainer');
    const tokenError = document.getElementById('tokenError');
    const logsPagination = document.getElementById('logsPagination');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');
    
    let currentPage = 1;
    const logsPerPage = 10;
    let allLogs = [];
    
    // Fetch logs when button is clicked
    fetchLogsBtn.addEventListener('click', fetchLogs);
    
    // Also fetch logs when Enter is pressed in the token input
    tokenInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            fetchLogs();
        }
    });
    
    // Pagination handlers
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            displayLogs();
        }
    });
    
    nextPageBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(allLogs.length / logsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            displayLogs();
        }
    });
    
    // Function to fetch logs from the server
    async function fetchLogs() {
        const token = tokenInput.value.trim();
        
        if (!token) {
            showError('Please enter a premium token');
            return;
        }
        
        // Clear previous errors
        hideError();
        
        // Show loading state
        logsContainer.innerHTML = '<p class="loading">Fetching logs...</p>';
        
        try {
            const response = await fetch(`/getlogs/${token}`);
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.success) {
                    allLogs = data.logs || [];
                    currentPage = 1;
                    displayLogs();
                } else {
                    showError(data.error || 'Failed to fetch logs');
                }
            } else if (response.status === 404) {
                showError('Token not found. Please check your token and try again.');
            } else {
                showError('Failed to fetch logs. Please try again later.');
            }
        } catch (error) {
            console.error('Error fetching logs:', error);
            showError('An error occurred while fetching logs. Please try again later.');
        }
    }
    
    // Function to display logs with pagination
    function displayLogs() {
        if (allLogs.length === 0) {
            logsContainer.innerHTML = '<p class="no-logs">No logs found for this token.</p>';
            logsPagination.style.display = 'none';
            return;
        }
        
        const totalPages = Math.ceil(allLogs.length / logsPerPage);
        const startIndex = (currentPage - 1) * logsPerPage;
        const endIndex = Math.min(startIndex + logsPerPage, allLogs.length);
        const logsToShow = allLogs.slice(startIndex, endIndex);
        
        let logsHTML = '<div class="logs-list">';
        logsToShow.forEach(log => {
            const timestamp = new Date(log.timestamp).toLocaleString();
            logsHTML += `
                <div class="log-item">
                    <div class="log-header">
                        <span class="log-timestamp">${timestamp}</span>
                        <span class="log-model">Model: ${log.modelUsed}</span>
                    </div>
                    <div class="log-details">
                        <p class="log-extracted-text"><strong>Extracted Text:</strong> ${log.extractedText || 'N/A'}</p>
                        <p class="log-ai-answers"><strong>AI Answers:</strong> ${log.aiAnswers || 'N/A'}</p>
                    </div>
                </div>
            `;
        });
        logsHTML += '</div>';
        
        logsContainer.innerHTML = logsHTML;
        
        // Update pagination
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage === totalPages;
        logsPagination.style.display = 'flex';
    }
    
    // Function to show error messages
    function showError(message) {
        tokenError.textContent = message;
        tokenError.style.display = 'block';
    }
    
    // Function to hide error messages
    function hideError() {
        tokenError.style.display = 'none';
    }
});
