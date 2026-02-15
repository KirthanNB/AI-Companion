import sys
import json
import time

# Try to import pydirectinput, provide helpful error if missing
try:
    import pydirectinput
    # Disable fail-safe for games if needed, or keep it for safety (move mouse to corner to abort)
    pydirectinput.FAILSAFE = True
except ImportError:
    sys.stderr.write("ERROR: pydirectinput not installed. Run: pip install pydirectinput\n")
    sys.stderr.flush()
    sys.exit(1)

def handle_command(command):
    try:
        cmd_type = command.get('type')
        
        if cmd_type == 'mouseMove':
            x = command.get('x')
            y = command.get('y')
            if x is not None and y is not None:
                pydirectinput.moveTo(int(x), int(y))
            
        elif cmd_type == 'click':
            button = command.get('button', 'left')
            pydirectinput.click(button=button)
            
        elif cmd_type == 'press':
            key = command.get('key')
            if key:
                pydirectinput.press(key)
            
        elif cmd_type == 'keyDown':
            key = command.get('key')
            if key:
                pydirectinput.keyDown(key)
            
        elif cmd_type == 'keyUp':
            key = command.get('key')
            if key:
                pydirectinput.keyUp(key)
            
        elif cmd_type == 'type':
            text = command.get('text')
            if text:
                pydirectinput.write(text, interval=0.02)
            
        elif cmd_type == 'paste':
            # Handle paste by using clipboard
            text = command.get('text')
            if text:
                try:
                    import pyperclip
                    pyperclip.copy(text)
                    pydirectinput.hotkey('ctrl', 'v')
                except ImportError:
                    # Fallback to typing if pyperclip not available
                    pydirectinput.write(text, interval=0.02)
            
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def main():
    # Signal that the bridge is ready
    print(json.dumps({"status": "ready", "message": "Python input bridge ready"}))
    sys.stdout.flush()
    
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                # stdin closed, exit gracefully
                break
            
            line = line.strip()
            if not line:
                continue
                
            command = json.loads(line)
            result = handle_command(command)
            
            # Send result back
            print(json.dumps(result))
            sys.stdout.flush()
            
        except json.JSONDecodeError as e:
            # Log malformed JSON but continue
            sys.stderr.write(f"JSON decode error: {e}\n")
            sys.stderr.flush()
        except KeyboardInterrupt:
            break
        except Exception as e:
            sys.stderr.write(f"Error: {e}\n")
            sys.stderr.flush()

if __name__ == "__main__":
    main()
