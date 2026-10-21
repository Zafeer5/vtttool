import sys
import os
import tkinter as tk
from tkinter import filedialog

def choose_folder():
    try:
        root = tk.Tk()
        root.withdraw()
        root.lift()
        root.attributes('-topmost', True)
        
        initial_dir = sys.argv[1] if len(sys.argv) > 1 and os.path.isdir(sys.argv[1]) else os.path.expanduser("~")
        
        folder = filedialog.askdirectory(
            title="Select Destination Folder for Rendered Video",
            initialdir=initial_dir
        )
        root.destroy()
        if folder:
            # Normalize to Windows backslashes
            print(os.path.normpath(folder))
            return 0
        return 1
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    sys.exit(choose_folder())
