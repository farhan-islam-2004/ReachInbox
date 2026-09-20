import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCw, ArrowLeft } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught React Error caught by ErrorBoundary:', error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/scheduled';
  };

  public handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center font-sans select-none">
          <div className="w-16 h-16 rounded-full bg-red-50 text-red-500 flex items-center justify-center mb-4 shadow-sm border border-red-100">
            <AlertCircle className="w-8 h-8 stroke-[1.8]" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-gray-500 max-w-md mb-6 leading-relaxed">
            An unexpected error occurred while rendering this page. You can return to the dashboard or refresh the application.
          </p>

          {this.state.error && (
            <div className="max-w-md w-full bg-gray-50 rounded-xl p-3 mb-6 text-left border border-gray-200">
              <p className="text-xs font-mono text-red-600 break-words">
                {this.state.error.message}
              </p>
            </div>
          )}

          <div className="flex items-center space-x-3">
            <button
              onClick={this.handleReset}
              className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-full border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Dashboard</span>
            </button>
            <button
              onClick={this.handleReload}
              className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-full bg-[#00a63e] hover:bg-[#009237] text-white text-sm font-medium transition-colors shadow-sm"
            >
              <RotateCw className="w-4 h-4" />
              <span>Reload App</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
