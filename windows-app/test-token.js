const { getPremiumToken } = require('./capture');

console.log('Running getPremiumToken function...');
const token = getPremiumToken();
if (token) {
  console.log('Retrieved token:', token);
} else {
  console.log('No premium token found (returned null)');
}
