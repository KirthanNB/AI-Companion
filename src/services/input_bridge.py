import sys
import json
import pydirectinput
import time

# Disable fail-safe for games if needed, or keep it for safety (move mouse to corner to abort)
pydirectinput.FAILSAFE = True

def handle_command(command):
    try:
        cmd_type = command.get('type')
        
        if cmd_type == 'mouseMove':
            x = command.get('x')
            y = command.get('y')
            pydirectinput.moveTo(x, y)
            
        elif cmd_type == 'click':
            button = command.get('button', 'left')
            pydirectinput.click(button=button)
            
        elif cmd_type == 'press':
            key = command.get('key')
            pydirectinput.press(key)
            
        elif cmd_type == 'keyDown':
            key = command.get('key')
            pydirectinput.keyDown(key)
            
        elif cmd_type == 'keyUp':
            key = command.get('key')
            pydirectinput.keyUp(key)
            
        elif cmd_type == 'type':
            text = command.get('text')
            pydirectinput.write(text)
            
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def main():
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            
            command = json.loads(line)
            result = handle_command(command)
            
            # Send result back
            print(json.dumps(result))
            sys.stdout.flush()
            
        except json.JSONDecodeError:
            pass # Ignore malformed json
        except Exception as e:
            sys.stderr.write(f"Error: {e}\n")

if __name__ == "__main__":
    main()
