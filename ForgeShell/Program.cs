using System;
using System.IO;
using System.Text.Json;
using Photino.NET;

namespace ForgeShell;

class Program
{
    [STAThread]
    static void Main(string[] args) {
        var window = new PhotinoWindow()
        .SetTitle("Crucible Forge Shell")
        .SetUseOsDefaultSize(false)
        .SetWidth(1600)
        .SetHeight(900)
        .Center()
        .Load(new Uri("http://localhost:3000"));

        window.RegisterWebMessageReceivedHandler((object sender, string message) =>
            {
                var win = (PhotinoWindow)sender;
                try {
                    // Use a dynamic Document parser instead of a strict class
                    using JsonDocument doc = JsonDocument.Parse(message);
                    JsonElement root = doc.RootElement;

                    // ----------------------------------------------------
                    // ROUTE A: The Legacy 'Command / Data' Architecture
                    // ----------------------------------------------------
                    if (root.TryGetProperty("Command", out JsonElement cmdElement)) {
                        string command = cmdElement.GetString();
                        string data = root.TryGetProperty("Data", out JsonElement dataElement) ? dataElement.GetString(): "";

                        switch (command) {
                            case "GET_HISTORY":
                                if (Directory.Exists(data)) {
                                    var files = Directory.GetFiles(data, "*.htm*");
                                    var response = new {
                                        Command = "HISTORY_LIST",
                                        Data = string.Join(",", files)
                                    };
                                    win.SendWebMessage(JsonSerializer.Serialize(response));
                                }
                                break;

                            case "PICK_FOLDER":
                                try {
                                    // Execute Zenity (standard on Fedora) to get a folder path
                                    var process = new System.Diagnostics.Process {
                                        StartInfo = new System.Diagnostics.ProcessStartInfo {
                                            FileName = "zenity",
                                            Arguments = "--file-selection --directory --title='Select Project Workspace'",
                                            RedirectStandardOutput = true,
                                            UseShellExecute = false,
                                            CreateNoWindow = true,
                                        }
                                    };
                                    process.Start();
                                    string selectedPath = process.StandardOutput.ReadToEnd().Trim();
                                    process.WaitForExit();

                                    if (!string.IsNullOrEmpty(selectedPath)) {
                                        var response = new {
                                            Command = "SET_WORKSPACE_PATH",
                                            Data = selectedPath
                                        };
                                        win.SendWebMessage(JsonSerializer.Serialize(response));
                                    }
                                }
                                catch (Exception ex) {
                                    Console.WriteLine($"[SHELL ERROR] Zenity failure: {ex.Message}");
                                }
                                break;

                            case "LOG":
                                Console.WriteLine($"[UI]: {data}");
                                break;
                        }
                    }
                    // ----------------------------------------------------
                    // ROUTE B: The New 'Action' Architecture (Save Engine)
                    // ----------------------------------------------------
                    else if (root.TryGetProperty("action", out JsonElement actionElement)) {
                        string action = actionElement.GetString();

                        if (action == "SAVE_FILE") {
                            string filePath = root.GetProperty("path").GetString();
                            string fileContent = root.GetProperty("content").GetString();

                            // 1. Force explicit hardware write (Bypass OS Cache)
                            using (var stream = new FileStream(filePath, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
                            using (var writer = new StreamWriter(stream, new System.Text.UTF8Encoding(false))) {
                                writer.Write(fileContent);
                                writer.Flush();
                        }

                        // 2. Verify it actually stuck to the drive physically
                        FileInfo targetFile = new FileInfo(filePath);
                        long expectedBytes = new System.Text.UTF8Encoding(false).GetByteCount(fileContent);

                        if (targetFile.Exists && targetFile.Length == expectedBytes) {
                            win.SendWebMessage($"NOTIFY: Natively saved & verified {Path.GetFileName(filePath)}");
                        } else {
                            throw new Exception("Hardware verification failed. Byte footprint mismatch.");
                        }
                    }
                }
            }
            catch (Exception ex) {
                Console.WriteLine($"[BRIDGE ERROR]: {ex.Message}");
                win.SendWebMessage($"NOTIFY: ERROR - Native Host Exception: {ex.Message}");
            }
        });

    window.WaitForClose();
}
}