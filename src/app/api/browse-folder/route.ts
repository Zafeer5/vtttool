import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    let initialDir = '';
    try {
      const body = await req.json();
      if (body && body.initialDir) {
        initialDir = body.initialDir;
      }
    } catch {}

    const projectRoot = process.cwd();
    const pythonScript = path.join(projectRoot, 'scripts', 'browse_folder.py');
    const psScript = path.join(projectRoot, 'scripts', 'browse_folder.ps1');

    // Method 1: Python Tkinter Dialog
    const runPythonPicker = (): Promise<string | null> => {
      return new Promise((resolve) => {
        if (!fs.existsSync(pythonScript)) {
          return resolve(null);
        }
        const pythonExe = process.platform === 'win32' ? 'python' : 'python3';
        const args = [pythonScript];
        if (initialDir) args.push(initialDir);

        const child = spawn(pythonExe, args, {
          cwd: projectRoot,
          windowsHide: false,
        });

        let stdout = '';
        child.stdout.on('data', (d) => (stdout += d.toString('utf-8')));

        child.on('close', (code) => {
          if (code === 0 && stdout.trim()) {
            resolve(stdout.trim());
          } else {
            resolve(null);
          }
        });

        child.on('error', () => resolve(null));
      });
    };

    // Method 2: PowerShell Windows.Forms Dialog
    const runPowerShellPicker = (): Promise<string | null> => {
      return new Promise((resolve) => {
        if (process.platform !== 'win32' || !fs.existsSync(psScript)) {
          return resolve(null);
        }
        const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript];
        if (initialDir) args.push(initialDir);

        const child = spawn('powershell.exe', args, {
          cwd: projectRoot,
          windowsHide: false,
        });

        let stdout = '';
        child.stdout.on('data', (d) => (stdout += d.toString('utf-8')));

        child.on('close', (code) => {
          if (code === 0 && stdout.trim()) {
            resolve(stdout.trim());
          } else {
            resolve(null);
          }
        });

        child.on('error', () => resolve(null));
      });
    };

    let selectedFolder = await runPythonPicker();
    if (!selectedFolder) {
      selectedFolder = await runPowerShellPicker();
    }

    if (selectedFolder) {
      return NextResponse.json({
        success: true,
        folderPath: selectedFolder,
      });
    }

    return NextResponse.json({
      success: false,
      cancelled: true,
    });
  } catch (err: any) {
    console.error('Error in browse-folder route:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to open folder picker' },
      { status: 500 }
    );
  }
}
