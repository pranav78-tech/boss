const { mouse, Point } = require('@nut-tree-fork/nut-js');

async function testMouseMovement() {
  console.log('Testing mouse movement...');
  try {
    const currentPos = await mouse.getPosition();
    console.log(`Current position: (${currentPos.x}, ${currentPos.y})`);
    
    // Move slightly down and right
    const target = new Point(currentPos.x + 100, currentPos.y + 100);
    console.log(`Moving to: (${target.x}, ${target.y})`);
    
    await mouse.move([target]);
    console.log('Moved successfully!');
    
    // Return back
    await new Promise(resolve => setTimeout(resolve, 1000));
    await mouse.move([currentPos]);
    console.log('Returned successfully!');
  } catch (err) {
    console.error('Error during movement:', err);
  }
}

testMouseMovement();
