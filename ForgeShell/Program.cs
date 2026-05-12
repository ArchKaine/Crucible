using System;
using Photino.NET;

namespace ForgeShell;

class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        // Internal state to track if snapshots are allowed
        bool snapshotsEnabled = true;

        var window = new PhotinoWindow()
        .SetTitle("Crucible Forge Shell")
        // Mandatory for Fedora/Linux to respect the dimensions below
        .SetUseOsDefaultSize(false)
        .SetWidth(1280)
        .SetHeight(800)
        .Center()
        .Load(new Uri("http://localhost:3001"));

        // THE BRIDGE: Central communication hub
        window.RegisterWebMessageReceivedHandler((object sender, string message) =>
        {
            try {
                var delimiterIndex = message.IndexOf(':');
                if (delimiterIndex == -1)
                {
                    Console.WriteLine($"[EDITOR SAYS]: {message}");
                    return;
                }

                var command = message.Substring(0, delimiterIndex);
                var data = message.Substring(delimiterIndex + 1);

                switch (command)
                {

                    case "GET_HISTORY":
                        if (System.IO.Directory.Exists(data)) {
                            var files = System.IO.Directory.GetFiles(data, "*.htm*");
                            window.SendWebMessage("HISTORY_LIST:" + string.Join(",", files));
                        }
                        break;

                }
            }
            catch (Exception ex) {
                Console.WriteLine($"[BRIDGE ERROR] {ex.Message}");
            }
        });

        window.WaitForClose();
    }
}
