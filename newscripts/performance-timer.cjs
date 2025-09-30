/**
 * Performance timing utility that measures CPU time vs wall time
 * Helps distinguish between CPU-bound operations and I/O/network waiting
 */
class PerformanceTimer {
  constructor(name) {
    this.name = name;
    this.startCpu = null;
    this.startWall = null;
  }

  start() {
    this.startCpu = process.cpuUsage();
    this.startWall = process.hrtime.bigint();
    return this;
  }

  end() {
    const endCpu = process.cpuUsage(this.startCpu);
    const endWall = process.hrtime.bigint();
    
    const wallTimeMs = Number(endWall - this.startWall) / 1000000; // Convert nanoseconds to milliseconds
    const cpuTimeMs = (endCpu.user + endCpu.system) / 1000; // Convert microseconds to milliseconds
    
    return {
      name: this.name,
      wallTime: wallTimeMs,
      cpuTime: cpuTimeMs,
      userCpuTime: endCpu.user / 1000,
      systemCpuTime: endCpu.system / 1000,
      cpuUsage: wallTimeMs > 0 ? (cpuTimeMs / wallTimeMs * 100).toFixed(2) + '%' : '0%',
      waitTime: Math.max(0, wallTimeMs - cpuTimeMs),
      efficiency: wallTimeMs > 0 ? cpuTimeMs / wallTimeMs : 0
    };
  }

  endAndLog(enableLogging = true) {
    const result = this.end();
    
    if (enableLogging) {
      console.log(`⏱️  ${result.name}:`);
      console.log(`   Wall Time: ${result.wallTime.toFixed(2)}ms`);
      console.log(`   CPU Time:  ${result.cpuTime.toFixed(2)}ms (user: ${result.userCpuTime.toFixed(2)}ms, system: ${result.systemCpuTime.toFixed(2)}ms)`);
      console.log(`   CPU Usage: ${result.cpuUsage}`);
      console.log(`   Wait Time: ${result.waitTime.toFixed(2)}ms (I/O, network, etc.)`);
      console.log(`   Efficiency: ${(result.efficiency * 100).toFixed(1)}% (CPU/Wall ratio)`);
    }
    
    return result;
  }
}

/**
 * Utility function to time specific operations
 * @param {string} name - Name of the operation
 * @param {Function} operation - Function to time
 * @param {boolean} enableLogging - Whether to log results
 * @returns {*} Result of the operation
 */
function timeCpuOperation(name, operation, enableLogging = true) {
  const timer = new PerformanceTimer(name).start();
  
  try {
    const result = operation();
    
    if (result instanceof Promise) {
      return result.then(res => {
        timer.endAndLog(enableLogging);
        return res;
      }).catch(err => {
        timer.endAndLog(enableLogging);
        throw err;
      });
    } else {
      timer.endAndLog(enableLogging);
      return result;
    }
  } catch (error) {
    timer.endAndLog(enableLogging);
    throw error;
  }
}

/**
 * Format duration in milliseconds to human-readable format
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string
 */
function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms.toFixed(1)}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Create a performance summary from multiple timing results
 * @param {Object} timings - Object with timing results
 * @param {boolean} enableLogging - Whether to log the summary
 * @returns {Object} Performance summary
 */
function createPerformanceSummary(timings, enableLogging = true) {
  const summary = {
    totalWallTime: 0,
    totalCpuTime: 0,
    steps: {},
    overallEfficiency: 0
  };

  Object.entries(timings).forEach(([step, timing]) => {
    if (timing && timing.wallTime > 0) {
      summary.totalWallTime += timing.wallTime;
      summary.totalCpuTime += timing.cpuTime;
      summary.steps[step] = {
        wallTime: timing.wallTime,
        cpuTime: timing.cpuTime,
        cpuUsage: timing.cpuUsage,
        efficiency: timing.efficiency,
        waitTime: timing.waitTime
      };
    }
  });

  summary.overallEfficiency = summary.totalWallTime > 0 ? summary.totalCpuTime / summary.totalWallTime : 0;

  if (enableLogging) {
    console.log('\n📊 Performance Summary:');
    console.log(`   Total Wall Time: ${formatDuration(summary.totalWallTime)}`);
    console.log(`   Total CPU Time:  ${formatDuration(summary.totalCpuTime)}`);
    console.log(`   Overall CPU Usage: ${(summary.overallEfficiency * 100).toFixed(1)}%`);
    console.log(`   Total Wait Time: ${formatDuration(summary.totalWallTime - summary.totalCpuTime)}`);
    
    console.log('\n📈 Step Breakdown:');
    Object.entries(summary.steps).forEach(([step, data]) => {
      const percentage = (data.wallTime / summary.totalWallTime * 100).toFixed(1);
      console.log(`   ${step}: ${data.cpuUsage} CPU usage, ${formatDuration(data.wallTime)} (${percentage}% of total)`);
    });
  }

  return summary;
}

module.exports = { 
  PerformanceTimer, 
  timeCpuOperation, 
  formatDuration, 
  createPerformanceSummary 
};