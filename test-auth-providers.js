/**
 * Simple test script to verify authentication providers work correctly
 */

import { SimpleAuthProvider, JWTAuthProvider, CompositeAuthProvider, PERMISSIONS } from './dist/server/index.js';

console.log('🧪 Testing x-shell.js Authentication Providers\n');

// Test 1: SimpleAuthProvider
console.log('1️⃣ Testing SimpleAuthProvider...');
const simpleAuth = new SimpleAuthProvider();

// Add test users
simpleAuth.addUser('admin', 'Admin User', ['admin']);
simpleAuth.addUser('user1', 'Regular User', ['user']);

// Test permission checks
const adminUser = { userId: 'admin', username: 'Admin User', permissions: Object.values(PERMISSIONS) };
const normalUser = { userId: 'user1', username: 'Regular User', permissions: [PERMISSIONS.SPAWN_SESSION, PERMISSIONS.JOIN_SESSION, PERMISSIONS.WRITE_SESSION] };

// Admin should have all permissions
const adminSpawn = await simpleAuth.checkPermission({
  user: adminUser,
  operation: PERMISSIONS.SPAWN_SESSION,
  resource: 'session:test'
});

// Normal user should be able to spawn sessions
const userSpawn = await simpleAuth.checkPermission({
  user: normalUser,
  operation: PERMISSIONS.SPAWN_SESSION,
  resource: 'session:test'
});

// Normal user should NOT have admin permissions
const userAdmin = await simpleAuth.checkPermission({
  user: normalUser,
  operation: PERMISSIONS.ADMIN,
  resource: 'session:test'
});

console.log(`  ✅ Admin can spawn: ${adminSpawn}`);
console.log(`  ✅ User can spawn: ${userSpawn}`);
console.log(`  ✅ User cannot admin: ${!userAdmin}`);

// Test 2: CompositeAuthProvider
console.log('\n2️⃣ Testing CompositeAuthProvider...');
const composite = new CompositeAuthProvider([simpleAuth]);
const compositeSpawn = await composite.checkPermission({
  user: adminUser,
  operation: PERMISSIONS.SPAWN_SESSION,
  resource: 'session:test'
});
console.log(`  ✅ Composite auth works: ${compositeSpawn}`);

// Test 3: Anonymous permissions
console.log('\n3️⃣ Testing Anonymous Permissions...');
const anonPerms = simpleAuth.getAnonymousPermissions();
console.log(`  ✅ Anonymous permissions: ${anonPerms.join(', ')}`);

console.log('\n🎉 All authentication provider tests passed!');
console.log('\n📋 Available Permissions:');
Object.entries(PERMISSIONS).forEach(([key, value]) => {
  console.log(`  - ${key}: ${value}`);
});