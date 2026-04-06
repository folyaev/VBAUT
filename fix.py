import codecs

path = "C:/tgbotapi/VBAUT/frontend/src/App.jsx"
with codecs.open(path, "r", "utf-8") as f:
    lines = f.readlines()

for i in range(6000, 6300):
    if i < len(lines) and "const selectedReleaseAssets =" in lines[i]:
        print(f"Removing duplicate at line {i+1}")
        lines[i] = ""
        break

with codecs.open(path, "w", "utf-8") as f:
    f.writelines(lines)
