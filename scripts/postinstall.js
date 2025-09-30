#!/usr/bin/env node

const { createDefaultConfig } = require('../lib/config');

console.log('🚀 Setting up storybook-deployer...');
createDefaultConfig();
console.log('✨ Setup complete! You can now use storybook-deployer.');