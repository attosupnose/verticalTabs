// Popup script
document.addEventListener('DOMContentLoaded', () => {
  const actionBtn = document.getElementById('actionBtn');
  
  if (actionBtn) {
    actionBtn.addEventListener('click', () => {
      console.log('Button clicked!');
      // Add your logic here
    });
  }
});
