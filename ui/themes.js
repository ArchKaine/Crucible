if (typeof window.CrucibleThemes === 'undefined') {
    const CrucibleThemes = {
        chaos: {
            name: "Chaos (Dark)",
            ace: "ace/theme/chaos",
            term: {
                background: '#000000',
                foreground: '#888888',
                cursor: '#569cd6',
                selection: '#222222'
            },
            ui: {
                base: '#000000',
                panel: '#050505',
                surface: '#0a0a0a',
                hover: '#111111',
                borderDark: '#1a1a1a',
                borderLight: '#222222',
                textDim: '#444444',
                textMuted: '#666666',
                textMain: '#888888',
                textBright: '#cccccc',
                accent: '#569cd6'
            }
        },
        twilight: {
            name: "Twilight",
            ace: "ace/theme/twilight",
            term: {
                background: '#141414',
                foreground: '#f8f8f8',
                cursor: '#8f9d6a',
                selection: '#323232'
            },
            ui: {
                base: '#141414',
                panel: '#1e1e1e',
                surface: '#252525',
                hover: '#2f2f2f',
                borderDark: '#3a3a3a',
                borderLight: '#4a4a4a',
                textDim: '#777777',
                textMuted: '#999999',
                textMain: '#bbbbbb',
                textBright: '#eeeeee',
                accent: '#8f9d6a'
            }
        },
        industrial: {
            name: "Industrial",
            ace: "ace/theme/mono_industrial",
            term: {
                background: '#0a0a0a',
                foreground: '#777777',
                cursor: '#444444',
                selection: '#1a1a1a'
            },
            ui: {
                base: '#0a0a0a',
                panel: '#111111',
                surface: '#1a1a1a',
                hover: '#222222',
                borderDark: '#333333',
                borderLight: '#444444',
                textDim: '#666666',
                textMuted: '#888888',
                textMain: '#aaaaaa',
                textBright: '#dddddd',
                accent: '#ff9800'
            }
        },
        dracula: {
            name: "Dracula",
            ace: "ace/theme/dracula",
            term: {
                background: '#282a36',
                foreground: '#f8f8f2',
                cursor: '#ff79c6',
                selection: '#44475a'
            },
            ui: {
                base: '#282a36',
                panel: '#21222c',
                surface: '#1e1f29',
                hover: '#44475a',
                borderDark: '#191a21',
                borderLight: '#6272a4',
                textDim: '#6272a4',
                textMuted: '#bfbfbf',
                textMain: '#f8f8f2',
                textBright: '#ffffff',
                accent: '#bd93f9'
            }
        },
        nord: {
            name: "Nord",
            ace: "ace/theme/nord_dark",
            term: {
                background: '#2e3440',
                foreground: '#d8dee9',
                cursor: '#88c0d0',
                selection: '#434c5e'
            },
            ui: {
                base: '#2e3440',
                panel: '#3b4252',
                surface: '#434c5e',
                hover: '#4c566a',
                borderDark: '#242933',
                borderLight: '#4c566a',
                textDim: '#4c566a',
                textMuted: '#d8dee9',
                textMain: '#e5e9f0',
                textBright: '#eceff4',
                accent: '#81a1c1'
            }
        },
        monokai: {
            name: "Monokai",
            ace: "ace/theme/monokai",
            term: {
                background: '#272822',
                foreground: '#f8f8f2',
                cursor: '#f92672',
                selection: '#49483e'
            },
            ui: {
                base: '#272822',
                panel: '#1e1f1c',
                surface: '#171814',
                hover: '#3e3d32',
                borderDark: '#11110e',
                borderLight: '#49483e',
                textDim: '#75715e',
                textMuted: '#cfcfc2',
                textMain: '#f8f8f2',
                textBright: '#ffffff',
                accent: '#a6e22e'
            }
        }
    };
    window.CrucibleThemes = CrucibleThemes;
}