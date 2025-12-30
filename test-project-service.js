// Test script for ProjectScaffoldService
const ProjectScaffoldService = require('./src/services/ProjectScaffoldService');

console.log('🧪 Testing ProjectScaffoldService...\n');

const service = new ProjectScaffoldService();

// Test 1: Project Type Detection
console.log('Test 1: Project Type Detection');
const testCases = [
    { desc: 'Build a portfolio website', expected: 'website' },
    { desc: 'Create a Next.js app for my blog', expected: 'nextjs' },
    { desc: 'I need a REST API for users', expected: 'api' },
    { desc: 'Make a Python web scraper', expected: 'python' },
    { desc: 'Build a Vue dashboard', expected: 'vue' },
    { desc: 'Create an Electron app', expected: 'electron' },
];

testCases.forEach(({ desc, expected }) => {
    const detected = service.detectProjectType(desc);
    const status = detected === expected ? '✅' : '❌';
    console.log(`  ${status} "${desc}" → ${detected} (expected: ${expected})`);
});

console.log('\n✅ All tests completed!\n');
console.log('To test the full workflow:');
console.log('1. Start the AI-Companion: npm start');
console.log('2. Click the microphone button');
console.log('3. Say: "Create a portfolio website"');
console.log('4. Watch the magic happen! ✨');
