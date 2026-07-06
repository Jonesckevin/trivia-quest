// ==================== ADMIN PREVIEW ==================== //

// Open admin preview in new window
function openAdminPreview() {
    const width = 1400;
    const height = 900;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    
    window.open(
        'admin-preview.html',
        'AdminPreview',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
}

// Initialize event listeners
function initAdminPreview() {
    const adminPreviewBtn = document.getElementById('adminPreviewBtn');
    if (adminPreviewBtn) {
        adminPreviewBtn.addEventListener('click', openAdminPreview);
    }
}

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', initAdminPreview);
